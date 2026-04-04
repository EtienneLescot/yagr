import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { YagrN8nConfigService, resolveN8nRuntimeState, resolveWorkflowDir, type YagrN8nLocalConfig } from '../config/n8n-config-service.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { resolvePackageManagerCommand, resolvePackageManagerSpawnOptions } from '../system/package-manager.js';
import { extractN8nacOperation, splitN8nacArgv } from './n8nac-command.js';
import { emitToolEvent, quoteShellArg, type ToolExecutionObserver } from './observer.js';
import { ensureN8nRelayServer, N8N_RELAY_CREDENTIAL_NAME, N8N_RELAY_FAKE_API_KEY } from '../llm/n8n-relay-server.js';
import { relativeWorkspacePath, resolveWorkspacePath, truncateText, workspaceRoot } from './workspace-utils.js';

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
  'yagr_proxy_warning_check',
  'yagr_proxy_warning_accept',
  'yagr_proxy_relay_start',
] as const;

type N8nAcAction = typeof N8NAC_ACTIONS[number];

const YAGR_PROXY_WARNING_VERSION = 'yagr-proxy-v1';
const YAGR_PROXY_WARNING_MESSAGE = 'Using Yagr proxy credentials with provider-linked accounts (for example Copilot or Codex OAuth sessions) remains subject to provider terms. High-volume automation or policy-violating usage may lead to account limits or suspension.';

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

function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.search(/[\[{]/);
    if (firstBrace < 0) {
      return undefined;
    }

    const candidate = trimmed.slice(firstBrace);
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
}

function normalizeN8nAcAction(action: N8nAcAction): string {
  return action;
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

function buildStructuredCommandResult(
  argv: string[],
  result: RunResult,
  configService = new YagrN8nConfigService(),
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: truncateText(result.stdout),
    stderr: truncateText(result.stderr),
    argv,
  };

  const operation = extractN8nacOperation({ action: 'command', commandArgv: argv });
  if (!operation) {
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
    return response;
  }

  if (operation === 'verify' || operation === 'pull') {
    response.workflowId = syncFacts.workflowId ?? argv[1] ?? null;
    response.workflowUrl = syncFacts.workflowUrl ?? null;
    response.title = syncFacts.workflowName ?? null;
    return response;
  }

  return response;
}

function findWorkspaceWorkflowCandidates(filename: string): string[] {
  const root = workspaceRoot();
  const target = filename.trim();
  if (!target) {
    return [];
  }

  const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage', '.cache']);

  const matches: string[] = [];
  const visit = (dirPath: string) => {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        visit(path.join(dirPath, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const entryPath = path.join(dirPath, entry.name);
      if (entry.name === target || relativeWorkspacePath(entryPath) === target) {
        matches.push(entryPath);
      }
    }
  };

  visit(root);
  return matches;
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
  const candidates = findWorkspaceWorkflowCandidates(filename);
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
    action: z.enum(N8NAC_ACTIONS).describe('Use action="command" for normal n8nac usage. The other actions are Yagr-specific helpers: llm_provider_options lists available LLM providers, yagr_proxy_warning_check/accept manage the one-time compliance warning, yagr_proxy_relay_start starts the local Yagr relay AND automatically creates the openAiApi credential in n8n (idempotent) — returns credentialId ready to assign.'),
    nodeName: z.string().nullable().describe('Optional workflow node name used for contextual provider-choice prompts.'),
    commandArgs: z.string().nullable().describe('Generic raw n8nac argument string for action="command", for example "workflow credential-required wf_123 --json".'),
    commandArgv: z.array(z.string()).nullable().describe('Generic raw n8nac argv for action="command", preferred over commandArgs when arguments contain spaces.'),
  }));

  return tool({
    description: 'Run n8n-as-code operations from the active workspace. Use action="command" for normal n8nac usage; the remaining actions are Yagr-specific helpers for provider selection and one-time warning state.',
    parameters: strictCompatibleParameters,
    execute: async ({
      action: rawAction,
      nodeName,
      commandArgs,
      commandArgv,
    }) => {
      const action = normalizeN8nAcAction(rawAction);
      const cwd = workspaceRoot();

      if (action === 'command') {
        const argv = Array.isArray(commandArgv) && commandArgv.length > 0
          ? commandArgv
          : commandArgs
            ? splitN8nacArgv(commandArgs)
            : null;

        if (!argv || argv.length === 0) {
          throw new Error('command requires commandArgv or commandArgs');
        }

        const configService = new YagrN8nConfigService();
        const normalizedArgv = normalizeCommandArgv(argv, configService);
        const result = await runObservedN8nac(observer, normalizedArgv, cwd);
        return buildStructuredCommandResult(normalizedArgv, result, configService);
      }

      if (action === 'yagr_proxy_warning_check') {
        const consent = new YagrConfigService().getYagrProxyCredentialWarningConsent();
        const accepted = consent?.warningVersion === YAGR_PROXY_WARNING_VERSION;
        return {
          accepted,
          warningVersion: YAGR_PROXY_WARNING_VERSION,
          warningMessage: YAGR_PROXY_WARNING_MESSAGE,
          acceptedAt: consent?.acceptedAt ?? null,
          next: accepted
            ? 'Yagr proxy warning already accepted; proceed without showing it again.'
            : 'Present this warning to the user once. If accepted, call yagr_proxy_warning_accept.',
        };
      }

      if (action === 'yagr_proxy_warning_accept') {
        const acceptedAt = new Date().toISOString();
        new YagrConfigService().saveYagrProxyCredentialWarningConsent({
          warningVersion: YAGR_PROXY_WARNING_VERSION,
          acceptedAt,
        });
        return {
          accepted: true,
          warningVersion: YAGR_PROXY_WARNING_VERSION,
          acceptedAt,
          next: 'Warning acceptance saved. Do not show this warning again unless warningVersion changes.',
        };
      }

      if (action === 'llm_provider_options') {
        const options = getLlmProviderCatalog();
        const credentialsResult = await runObservedN8nac(observer, ['credential', 'list', '--json'], cwd);
        const parsed = parseJsonPayload(credentialsResult.stdout);
        const credentials = Array.isArray(parsed)
          ? parsed as Array<{ id?: string; name?: string; type?: string }>
          : [];
        const consent = new YagrConfigService().getYagrProxyCredentialWarningConsent();
        const warningAccepted = consent?.warningVersion === YAGR_PROXY_WARNING_VERSION;

        return {
          nodeName: nodeName ?? null,
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
          yagrWarning: {
            accepted: warningAccepted,
            warningVersion: YAGR_PROXY_WARNING_VERSION,
            warningMessage: YAGR_PROXY_WARNING_MESSAGE,
            acceptedAt: consent?.acceptedAt ?? null,
          },
          credentialListExitCode: credentialsResult.exitCode,
          credentialListStderr: truncateText(credentialsResult.stderr),
          next: 'Ask the user which provider to use for this node. Prefer existing credentials; create a new one only if needed. Only offer providers marked available=true. For Yagr Proxy (frictionless, no API key), call yagr_proxy_relay_start — it starts the relay, creates the openAiApi credential in n8n automatically, and returns the credential id ready to assign.',
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

        if (existing) {
          return {
            port: relay.port,
            baseUrl: relay.baseUrl,
            credentialId: existing.id ?? null,
            credentialName: N8N_RELAY_CREDENTIAL_NAME,
            credentialType: 'openAiApi',
            created: false,
            next: `Relay is running and credential "${N8N_RELAY_CREDENTIAL_NAME}" (id: ${existing.id}) already exists. Assign it to the node.`,
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
