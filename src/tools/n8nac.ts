import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { YagrN8nConfigService, resolveN8nRuntimeState, resolveWorkflowDir, type YagrN8nLocalConfig } from '../config/n8n-config-service.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { resolvePackageManagerCommand, resolvePackageManagerSpawnOptions } from '../system/package-manager.js';
import { emitToolEvent, quoteShellArg, type ToolExecutionObserver } from './observer.js';
import { ensureN8nRelayServer, N8N_RELAY_CREDENTIAL_NAME, N8N_RELAY_FAKE_API_KEY } from '../llm/llm-relay-server.js';
import { findFileInWorkspace, parseJsonPayload, relativeWorkspacePath, resolveWorkspacePath, splitShellArgv, truncateText, workspaceRoot } from './workspace-utils.js';
import { pollUntil } from '../system/async-poll.js';

// ─── N8n credential REST helpers ─────────────────────────────────────────────

/**
 * Patches the stored data of an existing n8n credential via the public REST API.
 * Used to update the relay URL in "Yagr LLM Proxy" without changing the credential ID
 * (which would break all workflows that reference it).
 */
async function patchN8nCredential(
  host: string,
  apiKey: string,
  credentialId: string,
  data: Record<string, string>,
): Promise<boolean> {
  try {
    const url = `${host.replace(/\/+$/, '')}/api/v1/credentials/${credentialId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function resolveN8nacOperation(argv: string[]): string {
  const [head, second] = argv;
  if (head === 'workflow' && second === 'activate') return 'workflow_activate';
  if (head === 'workflow' && second === 'deactivate') return 'workflow_deactivate';
  if (head === 'workflow' && second === 'credential-required') return 'workflow_credential_required';
  if (head === 'credential' && second === 'schema') return 'credential_schema';
  if (head === 'credential' && second === 'list') return 'credential_list';
  if (head === 'credential' && second === 'get') return 'credential_get';
  if (head === 'credential' && second === 'create') return 'credential_create';
  if (head === 'credential' && second === 'delete') return 'credential_delete';
  if (head === 'execution' && second === 'list') return 'execution_list';
  if (head === 'execution' && second === 'get') return 'execution_get';
  if (head === 'skills' && second === 'validate') return 'validate';
  if (head === 'skills') return 'skills';
  if (head === 'test-plan') return 'test_plan';
  if (head === 'init-auth') return 'init_auth';
  if (head === 'init-project') return 'init_project';
  if (head === 'update-ai') return 'update_ai';
  if (head === 'setup-check') return 'setup_check';
  return head ?? 'unknown';
}

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

type WorkflowSyncFacts = {
  workflowId?: string;
  workflowName?: string;
  workflowUrl?: string;
};

type WorkflowSyncState = {
  workflows?: Record<string, {
    filename?: string;
    lastSyncedHash?: string;
    lastSyncedAt?: string;
  }>;
};

const N8NAC_ACTIONS = [
  'command',
  'llm_provider_options',
  'yagr_proxy_relay_start',
] as const;

type N8nAcAction = typeof N8NAC_ACTIONS[number];

type LlmProviderOption = {
  id: string;
  label: string;
  credentialType: string;
  frictionless: boolean;
  available: boolean;
  note?: string;
};

function getLlmProviderCatalog(): LlmProviderOption[] {
  return [
    {
      id: 'yagr',
      label: 'Yagr Proxy',
      credentialType: 'openAiApi',
      frictionless: true,
      available: true,
      note: 'Yagr runs a local OpenAI-compatible relay server that forwards requests to the LLM provider configured in Yagr (any provider — Copilot, OpenAI OAuth, Anthropic, OpenRouter, etc.). No API key required in n8n; Yagr must be running during workflow execution.',
    },
    { id: 'openai', label: 'OpenAI', credentialType: 'openAiApi', frictionless: false, available: true },
    { id: 'anthropic', label: 'Anthropic', credentialType: 'anthropicApi', frictionless: false, available: true },
    { id: 'google', label: 'Google Gemini', credentialType: 'googlePalmApi', frictionless: false, available: true },
    { id: 'mistral', label: 'Mistral', credentialType: 'mistralCloudApi', frictionless: false, available: true },
    { id: 'openrouter', label: 'OpenRouter', credentialType: 'openRouterApi', frictionless: false, available: true },
  ];
}



function runN8nac(
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void | Promise<void>,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(resolvePackageManagerCommand('npx'), ['--yes', 'n8nac', ...args], {
      cwd,
      env: { ...process.env, ...getN8nacProcessEnv(env) },
      stdio: 'pipe',
      ...resolvePackageManagerSpawnOptions(),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (result: RunResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      void onOutput?.('stdout', text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      void onOutput?.('stderr', text);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ stdout, stderr: stderr || 'Process timed out.', exitCode: 1, timedOut: true });
      }, 2_000);
    }, 120_000);

    child.on('error', (error) => {
      finish({ stdout, stderr: error.message || stderr, exitCode: 1, timedOut });
    });

    child.on('close', (exitCode) => {
      finish({ stdout, stderr, exitCode: exitCode ?? 1, timedOut });
    });
  });
}

export function getN8nacProcessEnv(env: NodeJS.ProcessEnv = {}, configService = new YagrN8nConfigService()): NodeJS.ProcessEnv {
  const nextEnv = { ...env };
  const allowEnvironmentFallback = (env.YAGR_ALLOW_N8N_ENV ?? process.env.YAGR_ALLOW_N8N_ENV) === '1';
  const resolved = resolveN8nRuntimeState(configService, { ...process.env, ...env }, { allowEnvironmentFallback });

  if (nextEnv.N8N_HOST && nextEnv.N8N_API_KEY) {
    return nextEnv;
  }

  if (!resolved.host || !resolved.apiKey) {
    return nextEnv;
  }

  if (!nextEnv.N8N_HOST) {
    nextEnv.N8N_HOST = resolved.host;
  }

  if (!nextEnv.N8N_API_KEY) {
    nextEnv.N8N_API_KEY = resolved.apiKey;
  }

  return nextEnv;
}

function sanitizeEnvValue(value: string | undefined): string {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

export interface WorkflowNodeMisconfiguration {
  nodeType: string;
  issue: string;
  fix: string;
}

/**
 * Scans a .workflow.ts source file for known node misconfigurations that cause
 * silent runtime failures. Currently detects:
 *
 * - lmChatOpenAi with a custom baseURL but without responsesApiEnabled: false.
 *   When responsesApiEnabled is true (the v1.3 default), n8n sends the request
 *   to https://api.openai.com/v1/responses, bypassing the custom baseURL entirely
 *   and failing with "Input required: specify prompt or messages" on any proxy.
 */
export function detectWorkflowNodeMisconfigurations(filePath: string): WorkflowNodeMisconfiguration[] {
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const issues: WorkflowNodeMisconfiguration[] = [];

  // Find every occurrence of the lmChatOpenAi type string in the source.
  // For each occurrence, extract the enclosing object literal and check
  // whether a custom baseURL is present alongside responsesApiEnabled: false.
  const typePattern = /lmChatOpenAi/g;
  let match: RegExpExecArray | null;

  while ((match = typePattern.exec(source)) !== null) {
    // Walk backwards from the match to find the start of the enclosing @node
    // or object literal (the nearest '{' that begins the parameters block).
    // Strategy: find the nearest '{' scanning backwards, then locate the
    // balanced closing '}' scanning forwards.
    const before = source.slice(0, match.index);
    const after = source.slice(match.index);

    // Find the opening brace of the outermost surrounding object by scanning
    // forward from here until we either find a parameters: { ... } block
    // or the next occurrence of lmChatOpenAi ends the search.
    // Simpler approach: take the surrounding 2 KB window and scan it.
    const window = source.slice(Math.max(0, match.index - 500), match.index + 1500);

    const hasCustomBaseUrl = /baseURL\s*:|baseUrl\s*:/i.test(window);
    const hasResponsesApiDisabled = /responsesApiEnabled\s*:\s*false/.test(window);

    if (hasCustomBaseUrl && !hasResponsesApiDisabled) {
      issues.push({
        nodeType: 'lmChatOpenAi',
        issue:
          'Node uses a custom baseURL (proxy/relay) but responsesApiEnabled is not set to false. ' +
          'n8n v1.3+ defaults responsesApiEnabled to true, which makes n8n send requests to ' +
          'https://api.openai.com/v1/responses instead of the custom baseURL, causing ' +
          '"Input required: specify prompt or messages" at runtime.',
        fix: 'Add responsesApiEnabled: false to the node parameters alongside the options.baseURL.',
      });
    }
  }

  return issues;
}

function parseWorkflowSyncFacts(stdout: string, stderr: string, host: string | undefined): WorkflowSyncFacts {
  const combined = `${stdout}\n${stderr}`;
  const workflowId = combined.match(/Fetching workflow ([A-Za-z0-9_-]+) from n8n for verification/i)?.[1]
    || combined.match(/workflow\/([A-Za-z0-9_-]+)/i)?.[1];
  const workflowName = combined.match(/Fetched "([^"]+)"/i)?.[1];
  const normalizedHost = sanitizeEnvValue(host);
  const workflowUrl = workflowId && normalizedHost
    ? `${normalizedHost.replace(/\/+$/g, '')}/workflow/${workflowId}`
    : undefined;

  return {
    workflowId: workflowId || undefined,
    workflowName: workflowName || undefined,
    workflowUrl,
  };
}

function readWorkflowSyncState(statePath: string): WorkflowSyncState | undefined {
  if (!statePath || !fs.existsSync(statePath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as WorkflowSyncState;
  } catch {
    return undefined;
  }
}

function parseWorkflowNameFromFile(filePath: string): string | undefined {
  if (!filePath || !fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    const source = fs.readFileSync(filePath, 'utf-8');
    const match = source.match(/@workflow\(\{[\s\S]*?name:\s*['"]([^'"]+)['"]/);
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function resolveWorkflowSyncFactsFromLocalState(
  pushTarget: string | undefined,
  host: string | undefined,
  configService = new YagrN8nConfigService(),
): WorkflowSyncFacts {
  const normalizedTarget = path.basename(String(pushTarget || '').trim());
  if (!normalizedTarget) {
    return {};
  }

  const workflowDir = resolveWorkflowDir(configService.getLocalConfig());
  if (!workflowDir) {
    return {};
  }

  const state = readWorkflowSyncState(path.join(workflowDir, '.n8n-state.json'));
  const workflowEntries = Object.entries(state?.workflows || {});
  const match = workflowEntries.find(([, entry]) => path.basename(String(entry?.filename || '')) === normalizedTarget);
  if (!match) {
    return {};
  }

  const [workflowId, entry] = match;
  const normalizedHost = sanitizeEnvValue(host);
  const workflowUrl = normalizedHost
    ? `${normalizedHost.replace(/\/+$/g, '')}/workflow/${workflowId}`
    : undefined;
  const candidatePath = path.join(workflowDir, String(entry?.filename || normalizedTarget));
  const workflowName = parseWorkflowNameFromFile(candidatePath)
    || path.basename(String(entry?.filename || normalizedTarget), '.workflow.ts');

  return {
    workflowId,
    workflowName,
    workflowUrl,
  };
}

async function pollExecutionResult(
  observer: ToolExecutionObserver | undefined,
  workflowId: string,
  cwd: string,
  host: string | undefined,
  configService: YagrN8nConfigService,
): Promise<{ executionId: string; status: string; output: string | null; errorMessage: string | null; errorNodeName: string | null; summary: string } | null> {
  // Step 1: poll until the latest execution for this workflow is no longer running.
  // The generic pollUntil handles the retry loop and timeout — n8n-specific logic
  // lives only in the predicate below (which commands to call, which statuses mean "done").
  const executionId = await pollUntil<string>(async () => {
    const listResult = await runObservedN8nac(
      observer,
      ['execution', 'list', '--workflow-id', workflowId, '--limit', '1', '--json'],
      cwd,
    );
    const parsed = parseJsonPayload(listResult.stdout);
    const executions = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.data)
        ? (parsed as Record<string, unknown>).data as unknown[]
        : null;
    const latest = Array.isArray(executions) ? executions[0] as Record<string, unknown> : null;
    if (!latest) return null;
    const id = String(latest.id ?? '').trim() || null;
    const status = String(latest.status ?? '').toLowerCase();
    // Still in-flight — keep polling
    if (status === 'running' || status === 'new') return null;
    return id;
  }, { intervalMs: 2000, timeoutMs: 30_000 });

  if (!executionId) return null;

  // Step 2: fetch execution detail
  const getResult = await runObservedN8nac(
    observer,
    ['execution', 'get', executionId, '--include-data', '--json'],
    cwd,
  );
  const detail = parseJsonPayload(getResult.stdout) as Record<string, unknown> | undefined;
  const status = String((detail as Record<string, unknown>)?.status ?? 'unknown');
  const success = status === 'success';

  // Best-effort: extract a readable output from the last node's execution data
  let output: string | null = null;
  let errorMessage: string | null = null;
  let errorNodeName: string | null = null;
  try {
    const data = (detail as Record<string, unknown>)?.data as Record<string, unknown>;
    const resultData = data?.resultData as Record<string, unknown>;
    const runData = resultData?.runData as Record<string, unknown[]>;
    // Extract error from lastNodeExecuted
    const lastNodeName = String(resultData?.lastNodeExecuted ?? '');
    if (lastNodeName) errorNodeName = lastNodeName;
    const error = resultData?.error as Record<string, unknown> | undefined;
    if (error) {
      errorMessage = String(error.message ?? error.description ?? '').trim() || null;
    }
    if (runData) {
      const lastNodeData = lastNodeName ? runData[lastNodeName] : Object.values(runData).at(-1);
      const firstExec = Array.isArray(lastNodeData) ? lastNodeData[0] as Record<string, unknown> : undefined;
      // Check for per-node error
      if (!errorMessage && firstExec?.error) {
        const nodeErr = firstExec.error as Record<string, unknown>;
        errorMessage = String(nodeErr.message ?? nodeErr.description ?? '').trim() || null;
      }
      if (!errorMessage && Array.isArray(firstExec?.error)) {
        errorMessage = JSON.stringify(firstExec?.error);
      }
      if (success) {
        // main is an array of item arrays: [[{json:{...}}], ...]
        const main = (firstExec?.data as Record<string, unknown>)?.main;
        const firstBranch = Array.isArray(main) ? main[0] : undefined;
        const firstItem = Array.isArray(firstBranch) ? firstBranch[0] as Record<string, unknown> : undefined;
        const json = firstItem?.json as Record<string, unknown> | undefined;
        if (json) {
          // AI agent nodes typically put the response in json.output
          const text = json.output ?? json.text ?? json.response ?? json.answer ?? json.result;
          output = typeof text === 'string' ? text : JSON.stringify(json);
        }
      }
    }
  } catch {
    // ignore
  }

  let summary: string;
  if (success) {
    summary = `Async execution confirmed: executionId=${executionId} status=success${output ? `\nAgent output: ${output}` : ''}`;
  } else {
    const where = errorNodeName ? ` in node "${errorNodeName}"` : '';
    const why = errorMessage ? `\nError: ${errorMessage}` : '';
    summary = `Async execution failed: executionId=${executionId} status=${status}${where}.${why}\nYou must inspect this error, fix the workflow file accordingly, push again, and re-test.`;
  }

  return { executionId, status, output, errorMessage, errorNodeName, summary };
}

async function buildStructuredCommandResult(
  argv: string[],
  result: RunResult,
  configService = new YagrN8nConfigService(),
  observer?: ToolExecutionObserver,
  cwd = process.cwd(),
): Promise<Record<string, unknown>> {
  const response: Record<string, unknown> = {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: truncateText(result.stdout),
    stderr: truncateText(result.stderr),
    argv,
  };

  const operation = resolveN8nacOperation(argv);
  response.operation = operation;
  if (!operation || operation === 'unknown') {
    return response;
  }

  const resolved = resolveN8nRuntimeState(configService, process.env, {
    allowEnvironmentFallback: process.env.YAGR_ALLOW_N8N_ENV === '1',
  });
  const syncFacts = parseWorkflowSyncFacts(result.stdout, result.stderr, resolved.host);

  if (operation === 'push') {
    const pushTarget = argv[1] ?? undefined;
    const fallbackFacts = (!syncFacts.workflowId || !syncFacts.workflowUrl)
      ? resolveWorkflowSyncFactsFromLocalState(pushTarget, resolved.host, configService)
      : {};
    response.pushTarget = argv[1] ?? null;
    response.workflowId = syncFacts.workflowId ?? fallbackFacts.workflowId ?? null;
    response.workflowUrl = syncFacts.workflowUrl ?? fallbackFacts.workflowUrl ?? null;
    response.title = syncFacts.workflowName ?? fallbackFacts.workflowName ?? null;
    response.verified = result.exitCode === 0 && Boolean(syncFacts.workflowId);
    response.operation = 'push';
    return response;
  }

  if (operation === 'verify' || operation === 'pull') {
    response.workflowId = syncFacts.workflowId ?? argv[1] ?? null;
    response.workflowUrl = syncFacts.workflowUrl ?? null;
    response.title = syncFacts.workflowName ?? null;
    response.operation = operation;
    return response;
  }

  if (operation === 'validate') {
    response.validateFile = argv[2] ?? null;
    response.operation = 'validate';
    return response;
  }

  if (operation === 'test') {
    // Detect async webhook trigger: n8n responds with {"message":"Workflow was started"}
    // which confirms HTTP acceptance only — the execution runs asynchronously and may fail.
    // Rather than exposing this ambiguity to the LLM (which tends to report it as success),
    // the tool resolves asyncness itself: poll execution list/get until the execution finishes.
    const isAsyncTrigger = /workflow was started/i.test(result.stdout);
    if (isAsyncTrigger) {
      const workflowId = argv[1] ?? null;
      if (workflowId) {
        const resolved2 = resolveN8nRuntimeState(configService, process.env, {
          allowEnvironmentFallback: process.env.YAGR_ALLOW_N8N_ENV === '1',
        });
        const polledResult = await pollExecutionResult(observer, workflowId, cwd, resolved2.host, configService);
        if (polledResult) {
          return {
            ...response,
            asyncTrigger: true,
            executionConfirmed: polledResult.status === 'success',
            executionId: polledResult.executionId,
            executionStatus: polledResult.status,
            executionOutput: polledResult.output,
            executionError: polledResult.errorMessage,
            executionErrorNode: polledResult.errorNodeName,
            stdout: result.stdout + '\n' + polledResult.summary,
          };
        }
      }
      // Fallback: couldn't poll — surface signal so completion gate doesn't accept
      response.asyncTrigger = true;
      response.executionConfirmed = false;
      response.note = 'The webhook accepted the request asynchronously but execution status could not be confirmed. Check execution list manually.';
    }
    return response;
  }

  return response;
}

function rankWorkspaceWorkflowCandidate(candidatePath: string, workflowDir: string | undefined): number {
  if (!workflowDir) {
    return 1;
  }

  const normalizedCandidate = path.resolve(candidatePath);
  const normalizedWorkflowDir = path.resolve(workflowDir);
  if (normalizedCandidate.startsWith(`${normalizedWorkflowDir}${path.sep}`)) {
    return 0;
  }

  return 1;
}

export function pickPreferredWorkspaceWorkflowCandidate(
  filename: string,
  configService = new YagrN8nConfigService(),
): string | undefined {
  const localConfig = configService.getLocalConfig();
  const workflowDir = resolveWorkflowDir(localConfig);
  const candidates = findFileInWorkspace(filename);
  if (candidates.length === 0) {
    return undefined;
  }

  return [...candidates].sort((left, right) => {
    const rankDelta = rankWorkspaceWorkflowCandidate(left, workflowDir) - rankWorkspaceWorkflowCandidate(right, workflowDir);
    if (rankDelta !== 0) {
      return rankDelta;
    }

    return left.localeCompare(right);
  })[0];
}

function normalizeWorkspaceRelativePath(candidatePath: string): string {
  const relativePath = relativeWorkspacePath(candidatePath);
  return relativePath || candidatePath;
}

function resolveCommandFileTarget(target: string | undefined, configService = new YagrN8nConfigService()): string | undefined {
  const normalizedTarget = String(target || '').trim();
  if (!normalizedTarget) {
    return undefined;
  }

  if (path.isAbsolute(normalizedTarget) && fs.existsSync(normalizedTarget)) {
    return normalizeWorkspaceRelativePath(normalizedTarget);
  }

  const workspaceTarget = path.resolve(workspaceRoot(), normalizedTarget);
  if (fs.existsSync(workspaceTarget)) {
    return normalizedTarget;
  }

  const preferredCandidate = pickPreferredWorkspaceWorkflowCandidate(normalizedTarget, configService)
    || pickPreferredWorkspaceWorkflowCandidate(path.basename(normalizedTarget), configService);

  return preferredCandidate ? normalizeWorkspaceRelativePath(preferredCandidate) : normalizedTarget;
}

function normalizeCommandArgv(argv: string[], configService = new YagrN8nConfigService()): string[] {
  if (argv.length === 0) {
    return argv;
  }

  const normalizedArgv = [...argv];
  if (argv[0] === 'push' && argv[1]) {
    normalizedArgv[1] = resolveCommandFileTarget(argv[1], configService) ?? argv[1];
    return normalizedArgv;
  }

  if (argv[0] === 'skills' && argv[1] === 'validate' && argv[2]) {
    normalizedArgv[2] = resolveCommandFileTarget(argv[2], configService) ?? argv[2];
    return normalizedArgv;
  }

  return normalizedArgv;
}

function summarizeN8nacRuntime(cwd: string, env: NodeJS.ProcessEnv = {}, configService = new YagrN8nConfigService()): string {
  const localConfig = configService.getLocalConfig();
  const allowEnvironmentFallback = (env.YAGR_ALLOW_N8N_ENV ?? process.env.YAGR_ALLOW_N8N_ENV) === '1';
  const resolved = resolveN8nRuntimeState(configService, { ...process.env, ...env }, { allowEnvironmentFallback });
  const envHost = sanitizeEnvValue(env.N8N_HOST ?? process.env.N8N_HOST);
  const envApiKey = sanitizeEnvValue(env.N8N_API_KEY ?? process.env.N8N_API_KEY);
  const configHost = sanitizeEnvValue(localConfig.host);
  const workflowDir = resolveWorkflowDir(localConfig);

  return [
    `cwd=${relativeWorkspacePath(cwd)}`,
    `envHost=${envHost || '-'}`,
    `envApiKey=${envApiKey ? 'present' : 'missing'}`,
    `configHost=${configHost || '-'}`,
    `configProject=${localConfig.projectName || localConfig.projectId || '-'}`,
    `configInstance=${localConfig.instanceIdentifier || '-'}`,
    `workflowDir=${workflowDir ? relativeWorkspacePath(workflowDir) : '-'}`,
    `resolvedHost=${resolved.host || '-'}`,
    `resolvedApiKey=${resolved.apiKey ? 'present' : 'missing'}`,
    `credentialsAvailable=${resolved.credentialsAvailable ? 'yes' : 'no'}`,
    `projectConfigured=${resolved.projectConfigured ? 'yes' : 'no'}`,
  ].join(' ');
}

async function runObservedN8nac(
  observer: ToolExecutionObserver | undefined,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<RunResult> {
  const command = [resolvePackageManagerCommand('npx'), '--yes', 'n8nac', ...args].map(quoteShellArg).join(' ');
  const runtimeSummary = summarizeN8nacRuntime(cwd, env);

  await emitToolEvent(observer, {
    type: 'status',
    toolName: 'n8nac',
    message: `Runtime ${runtimeSummary}`,
  });

  await emitToolEvent(observer, {
    type: 'command-start',
    toolName: 'n8nac',
    command,
    cwd: relativeWorkspacePath(cwd),
  });

  const result = await runN8nac(args, cwd, env, async (stream, chunk) => {
    await emitToolEvent(observer, {
      type: 'command-output',
      toolName: 'n8nac',
      stream,
      chunk,
    });
  });

  await emitToolEvent(observer, {
    type: 'command-end',
    toolName: 'n8nac',
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    message: result.exitCode === 0 ? 'Command completed.' : 'Correcting commands...',
  });

  return result;
}

function isWorkspaceInitialized(configService = new YagrN8nConfigService()): {
  initialized: boolean;
  credentialsAvailable: boolean;
  projectConfigured: boolean;
  host?: string;
  configPath: string;
  workflowDir?: string;
} {
  const configPath = resolveWorkspacePath('n8nac-config.json');
  const resolved = resolveN8nRuntimeState(configService, process.env, {
    allowEnvironmentFallback: process.env.YAGR_ALLOW_N8N_ENV === '1',
  });

  if (!fs.existsSync(configPath)) {
    return {
      initialized: resolved.initialized,
      credentialsAvailable: resolved.credentialsAvailable,
      projectConfigured: resolved.projectConfigured,
      host: resolved.host,
      configPath: relativeWorkspacePath(configPath),
      workflowDir: resolved.workflowDir ? relativeWorkspacePath(resolved.workflowDir) : undefined,
    };
  }

  return {
    initialized: resolved.initialized,
    credentialsAvailable: resolved.credentialsAvailable,
    projectConfigured: resolved.projectConfigured,
    host: resolved.host,
    configPath: relativeWorkspacePath(configPath),
    workflowDir: resolved.workflowDir ? relativeWorkspacePath(resolved.workflowDir) : undefined,
  };
}

export function createN8nAcTool(observer?: ToolExecutionObserver) {
  const strictCompatibleParameters = z.preprocess((input) => {
    if (!input || typeof input !== 'object') {
      return input;
    }

    const obj = input as Record<string, unknown>;
    // Some weaker models pass the string "null" instead of JSON null for
    // optional fields. Normalise before Zod validates typed constraints.
    const nullify = (v: unknown) => (v === 'null' || v === undefined ? null : v);
    return {
      ...obj,
      nodeName: nullify(obj.nodeName),
      commandArgs: nullify(obj.commandArgs),
      commandArgv: nullify(obj.commandArgv),
    };
  }, z.object({
    action: z.enum(N8NAC_ACTIONS).describe('Use action="command" for normal n8nac usage. action="llm_provider_options" lists available LLM providers. action="yagr_proxy_relay_start" starts the local Yagr relay AND automatically creates the openAiApi credential in n8n (idempotent) — returns credentialId ready to assign.'),
    nodeName: z.string().nullable().describe('Optional workflow node name used for contextual provider-choice prompts.'),
    commandArgs: z.string().nullable().describe('Generic raw n8nac argument string for action="command", for example "workflow credential-required wf_123 --json".'),
    commandArgv: z.array(z.string()).nullable().describe('Generic raw n8nac argv for action="command", preferred over commandArgs when arguments contain spaces.'),
  }));

  return tool({
    description: 'Run n8n-as-code operations from the active workspace. Use action="command" for normal n8nac usage; action="llm_provider_options" lists available LLM providers; action="yagr_proxy_relay_start" starts the Yagr relay and creates the openAiApi credential (idempotent).',
    parameters: strictCompatibleParameters,
    execute: async ({
      action: rawAction,
      nodeName,
      commandArgs,
      commandArgv,
    }) => {
        const action = rawAction;
      const cwd = workspaceRoot();

      if (action === 'command') {
        const argv = Array.isArray(commandArgv) && commandArgv.length > 0
          ? commandArgv
          : commandArgs
            ? splitShellArgv(commandArgs)
            : null;

        if (!argv || argv.length === 0) {
          throw new Error('command requires commandArgv or commandArgs');
        }

        const configService = new YagrN8nConfigService();
        const normalizedArgv = normalizeCommandArgv(argv, configService);

        // Pre-push validation: detect node misconfigurations that cause silent runtime failures.
        if (normalizedArgv[0] === 'push' && normalizedArgv[1]) {
          const targetPath = path.isAbsolute(normalizedArgv[1])
            ? normalizedArgv[1]
            : path.resolve(cwd, normalizedArgv[1]);
          const misconfigurations = detectWorkflowNodeMisconfigurations(targetPath);
          if (misconfigurations.length > 0) {
            const details = misconfigurations
              .map((m, i) => `[${i + 1}] ${m.nodeType}: ${m.issue} Fix: ${m.fix}`)
              .join('\n');
            return {
              exitCode: 1,
              stdout: '',
              stderr: `Pre-push validation failed — fix the following before pushing:\n${details}`,
              timedOut: false,
              operation: 'push',
              pushTarget: normalizedArgv[1],
              workflowId: null,
              workflowUrl: null,
              title: null,
              verified: false,
              misconfigurations,
            };
          }
        }

        const result = await runObservedN8nac(observer, normalizedArgv, cwd);
        return await buildStructuredCommandResult(normalizedArgv, result, configService, observer, cwd);
      }

      if (action === 'llm_provider_options') {
        const options = getLlmProviderCatalog();
        const proxyEnabled = new YagrConfigService().isLlmProxyEnabled();
        const credentialsResult = await runObservedN8nac(observer, ['credential', 'list', '--json'], cwd);
        const parsed = parseJsonPayload(credentialsResult.stdout);
        const credentials = Array.isArray(parsed)
          ? parsed as Array<{ id?: string; name?: string; type?: string }>
          : [];

        return {
          nodeName: nodeName ?? null,
          yagrProxyEnabled: proxyEnabled,
          providers: options.map((provider) => ({
            ...provider,
            credentials: credentials
              .filter((entry) => (entry.type || '').trim() === provider.credentialType)
              .map((entry) => ({
                id: entry.id || null,
                name: entry.name || null,
                type: entry.type || null,
              })),
          })),
          credentialListExitCode: credentialsResult.exitCode,
          credentialListStderr: truncateText(credentialsResult.stderr),
          next: proxyEnabled
            ? 'Yagr Proxy is globally configured (user already consented at setup). It is the preferred provider — call yagr_proxy_relay_start directly, no warning needed.'
            : 'Ask the user which provider to use for this node. Prefer existing credentials; create a new one only if needed. Only offer providers marked available=true. For Yagr Proxy (frictionless, no API key), call yagr_proxy_relay_start.',
        };
      }

      if (action === 'yagr_proxy_relay_start') {
        const relay = await ensureN8nRelayServer();

        // Check whether the Yagr relay credential already exists.
        const listResult = await runObservedN8nac(observer, ['credential', 'list', '--json'], cwd);
        const existingList = parseJsonPayload(listResult.stdout);
        const existingCredentials = Array.isArray(existingList)
          ? existingList as Array<{ id?: string; name?: string; type?: string }>
          : [];
        const existing = existingCredentials.find(
          (c) => c.name === N8N_RELAY_CREDENTIAL_NAME && c.type === 'openAiApi',
        );

        if (existing?.id) {
          // Credential exists — check if the relay URL has rotated (e.g. tunnel restarted).
          // The credential ID must stay the same to avoid breaking existing workflow node refs,
          // so we PATCH the data in-place when the URL changed.
          const n8nRuntime = resolveN8nRuntimeState(new YagrN8nConfigService(), process.env, { allowEnvironmentFallback: true });
          const storedRelayUrl = (new YagrConfigService()).getLocalConfig().llmProxy?.credentialBaseUrl;

          let urlUpdated = false;
          if (storedRelayUrl !== relay.baseUrl && n8nRuntime.host && n8nRuntime.apiKey) {
            const patched = await patchN8nCredential(
              n8nRuntime.host,
              n8nRuntime.apiKey,
              existing.id,
              { apiKey: N8N_RELAY_FAKE_API_KEY, url: relay.baseUrl },
            );
            urlUpdated = patched;
          }

          const urlNote = urlUpdated ? ` URL rotated and updated to ${relay.baseUrl}.` : '';
          return {
            port: relay.port,
            baseUrl: relay.baseUrl,
            credentialId: existing.id,
            credentialName: N8N_RELAY_CREDENTIAL_NAME,
            credentialType: 'openAiApi',
            created: false,
            reused: true,
            urlUpdated,
            next: `Relay is running.${urlNote} Reusing existing credential "${N8N_RELAY_CREDENTIAL_NAME}" (id: ${existing.id}). Assign it to the node.`,
          };
        }

        // Create the openAiApi credential with the correct field name ("url", not "baseUrl").
        const credData = JSON.stringify({ apiKey: N8N_RELAY_FAKE_API_KEY, url: relay.baseUrl });
        const createResult = await runObservedN8nac(
          observer,
          ['credential', 'create', '--type', 'openAiApi', '--name', N8N_RELAY_CREDENTIAL_NAME, '--data', credData, '--json'],
          cwd,
        );
        const created = parseJsonPayload(createResult.stdout) as Record<string, unknown> | undefined;

        return {
          port: relay.port,
          baseUrl: relay.baseUrl,
          credentialId: (created?.id as string | undefined) ?? null,
          credentialName: N8N_RELAY_CREDENTIAL_NAME,
          credentialType: 'openAiApi',
          created: createResult.exitCode === 0,
          reused: false,
          createExitCode: createResult.exitCode,
          createStderr: createResult.stderr || null,
          next: createResult.exitCode === 0
            ? `Relay is running and credential "${N8N_RELAY_CREDENTIAL_NAME}" created (id: ${created?.id ?? '?'}). Assign it to the node.`
            : `Relay is running but credential creation failed (exit ${createResult.exitCode}). Inspect createStderr and fix before assigning.`,
        };
      }

      throw new Error(`Unsupported n8nac action: ${action}`);
    },
  });
}
