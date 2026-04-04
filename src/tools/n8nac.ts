import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { YagrN8nConfigService, resolveN8nRuntimeState, resolveWorkflowDir, type YagrN8nLocalConfig } from '../config/n8n-config-service.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { resolvePackageManagerCommand, resolvePackageManagerSpawnOptions } from '../system/package-manager.js';
import { emitToolEvent, quoteShellArg, type ToolExecutionObserver } from './observer.js';
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

const N8NAC_ACTIONS = [
  'setup_check',
  'init_auth',
  'init_project',
  'list',
  'pull',
  'push',
  'verify',
  'workflow_activate',
  'workflow_deactivate',
  'workflow_credential_required',
  'credential_schema',
  'credential_list',
  'credential_get',
  'credential_create',
  'credential_delete',
  'execution_list',
  'execution_get',
  'test',
  'test_plan',
  'test-plan',
  'llm_provider_options',
  'yagr_proxy_warning_check',
  'yagr_proxy_warning_accept',
  'skills',
  'validate',
  'update_ai',
  'resolve',
  'skillsArgs',
  'skillsArgv',
] as const;

type N8nAcAction = typeof N8NAC_ACTIONS[number];

const YAGR_PROXY_WARNING_VERSION = 'yagr-proxy-v1';
const YAGR_PROXY_WARNING_MESSAGE = 'Using Yagr proxy credentials with provider-linked accounts (for example Copilot or Codex OAuth sessions) remains subject to provider terms. High-volume automation or policy-violating usage may lead to account limits or suspension.';

type LlmProviderOption = {
  id: string;
  label: string;
  credentialType: string;
  frictionless: boolean;
};

function getLlmProviderCatalog(): LlmProviderOption[] {
  return [
    { id: 'yagr', label: 'Yagr Proxy (no API key)', credentialType: 'openAiApi', frictionless: true },
    { id: 'openai', label: 'OpenAI', credentialType: 'openAiApi', frictionless: false },
    { id: 'anthropic', label: 'Anthropic', credentialType: 'anthropicApi', frictionless: false },
    { id: 'google', label: 'Google Gemini', credentialType: 'googlePalmApi', frictionless: false },
    { id: 'mistral', label: 'Mistral', credentialType: 'mistralCloudApi', frictionless: false },
    { id: 'openrouter', label: 'OpenRouter', credentialType: 'openRouterApi', frictionless: false },
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

function normalizeN8nAcAction(action: N8nAcAction): Exclude<N8nAcAction, 'skillsArgs' | 'skillsArgv' | 'test-plan'> {
  if (action === 'skillsArgs' || action === 'skillsArgv') {
    return 'skills';
  }

  if (action === 'test-plan') {
    return 'test_plan';
  }

  return action;
}

function splitArgv(input: string): string[] | null {
  const args: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaping = false;

  for (const character of input) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === '\\' && quote !== '\'') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === '\'') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += '\\';
  }

  if (quote) {
    return null;
  }

  if (current) {
    args.push(current);
  }

  return args;
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
    const parseOptionalInt = (v: unknown): unknown => {
      const normalized = nullify(v);
      if (typeof normalized !== 'string') {
        return normalized;
      }

      const trimmed = normalized.trim();
      if (!trimmed) {
        return null;
      }

      if (!/^[-+]?\d+$/.test(trimmed)) {
        return normalized;
      }

      const numeric = Number.parseInt(trimmed, 10);
      return Number.isNaN(numeric) ? normalized : numeric;
    };
    const parseOptionalBoolean = (v: unknown): unknown => {
      const normalized = nullify(v);
      if (typeof normalized !== 'string') {
        return normalized;
      }

      const lowered = normalized.trim().toLowerCase();
      if (lowered === 'true' || lowered === '1') {
        return true;
      }
      if (lowered === 'false' || lowered === '0') {
        return false;
      }

      return normalized;
    };
    return {
      ...obj,
      n8nHost: nullify(obj.n8nHost),
      n8nApiKey: nullify(obj.n8nApiKey),
      projectId: nullify(obj.projectId),
      projectName: nullify(obj.projectName),
      projectIndex: parseOptionalInt(obj.projectIndex),
      listScope: nullify(obj.listScope),
      workflowId: nullify(obj.workflowId),
      filename: nullify(obj.filename),
      skillsArgs: nullify(obj.skillsArgs),
      skillsArgv: nullify(obj.skillsArgv),
      validateFile: nullify(obj.validateFile),
      syncFolder: nullify(obj.syncFolder),
      resolveMode: nullify(obj.resolveMode),
      credentialType: nullify(obj.credentialType),
      credentialId: nullify(obj.credentialId),
      credentialName: nullify(obj.credentialName),
      credentialData: nullify(obj.credentialData),
      credentialFile: nullify(obj.credentialFile),
      outputJson: parseOptionalBoolean(obj.outputJson),
      executionId: nullify(obj.executionId),
      executionStatus: nullify(obj.executionStatus),
      executionLimit: parseOptionalInt(obj.executionLimit),
      executionCursor: nullify(obj.executionCursor),
      includeData: parseOptionalBoolean(obj.includeData),
      nodeName: nullify(obj.nodeName),
      testData: nullify(obj.testData),
      testQuery: nullify(obj.testQuery),
      testProd: parseOptionalBoolean(obj.testProd),
    };
  }, z.object({
    action: z.enum(N8NAC_ACTIONS).describe('Primary n8nac action. Use skills for any n8nac skills subcommand; skillsArgs and skillsArgv are accepted as legacy aliases and normalize to skills.'),
    n8nHost: z.string().nullable().describe('n8n host URL for init_auth.'),
    n8nApiKey: z.string().nullable().describe('n8n API key for init_auth.'),
    projectId: z.string().nullable().describe('n8n project ID for init_project.'),
    projectName: z.string().nullable().describe('n8n project name for init_project.'),
    projectIndex: z.number().int().min(1).nullable().describe('1-based project selector for init_project.'),
    listScope: z.enum(['all', 'local', 'remote', 'distant']).nullable().describe('Workflow listing scope for list.'),
    workflowId: z.string().nullable().describe('Workflow ID for pull, verify, or resolve.'),
    filename: z.string().nullable().describe('Workflow filename including .workflow.ts for push.'),
    skillsArgs: z.string().nullable().describe('String form of n8nac skills arguments, for example search telegram.'),
    skillsArgv: z.array(z.string()).nullable().describe('Array form of n8nac skills arguments when values contain spaces.'),
    validateFile: z.string().nullable().describe('Local workflow file path for n8nac skills validate.'),
    syncFolder: z.string().nullable().describe('Sync folder to pass to init_project. Defaults to workflows.'),
    resolveMode: z.enum(['keep-current', 'keep-incoming']).nullable().describe('Conflict resolution mode for resolve.'),
    credentialType: z.string().nullable().describe('Credential type for credential_schema or credential_create (for example openAiApi or anthropicApi).'),
    credentialId: z.string().nullable().describe('Credential ID for credential_get or credential_delete.'),
    credentialName: z.string().nullable().describe('Credential display name for credential_create.'),
    credentialData: z.string().nullable().describe('Inline credential JSON string for credential_create. Prefer credentialFile to avoid shell-history secret leakage.'),
    credentialFile: z.string().nullable().describe('Credential JSON file path for credential_create.'),
    outputJson: z.boolean().nullable().describe('When true, pass --json for machine-readable output where supported.'),
    executionId: z.string().nullable().describe('Execution ID for execution_get.'),
    executionStatus: z.enum(['canceled', 'crashed', 'error', 'new', 'running', 'success', 'unknown', 'waiting']).nullable().describe('Execution status filter for execution_list.'),
    executionLimit: z.number().int().min(1).nullable().describe('Maximum execution rows to return for execution_list.'),
    executionCursor: z.string().nullable().describe('Pagination cursor for execution_list.'),
    includeData: z.boolean().nullable().describe('Include detailed run data for execution_list or execution_get.'),
    nodeName: z.string().nullable().describe('Optional workflow node name used for contextual provider-choice prompts.'),
    testData: z.string().nullable().describe('Inline JSON payload for n8nac test --data.'),
    testQuery: z.string().nullable().describe('Inline JSON query payload for n8nac test --query.'),
    testProd: z.boolean().nullable().describe('When true, use production webhook URL for n8nac test (--prod).'),
  }));

  return tool({
    description: 'Run n8n-as-code operations from the active workspace. Supports workflow lifecycle actions (list, pull, push, verify, resolve), credential management (schema, list, get, create, delete), execution diagnostics (execution_list, execution_get), and skills search/validation via action="skills" with skillsArgv.',
    parameters: strictCompatibleParameters,
    execute: async ({
      action,
      n8nHost,
      n8nApiKey,
      projectId,
      projectName,
      projectIndex,
      listScope,
      workflowId,
      filename,
      skillsArgs,
      skillsArgv,
      validateFile,
      syncFolder,
      resolveMode,
      credentialType,
      credentialId,
      credentialName,
      credentialData,
      credentialFile,
      outputJson,
      executionId,
      executionStatus,
      executionLimit,
      executionCursor,
      includeData,
      nodeName,
      testData,
      testQuery,
      testProd,
    }) => {
      action = normalizeN8nAcAction(action);
      const cwd = workspaceRoot();

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
          next: 'Ask the user which provider to use for this node. Prefer existing credentials; create a new one only if needed.',
        };
      }

      if (action === 'setup_check') {
        const status = isWorkspaceInitialized();
        return {
          ...status,
          workspaceRoot: relativeWorkspacePath(cwd),
          next: status.initialized
            ? `Workspace is initialized. All workflow files (.workflow.ts) MUST be created and edited inside the workflow directory: ${status.workflowDir ?? 'the configured workflow directory'}. Do not write workflow files anywhere else. You can list, pull, edit, validate, push, and verify workflows.`
            : status.credentialsAvailable
              ? 'n8n credentials are already available. Continue with init_project to finish workspace setup before creating, validating, pushing, and verifying workflows.'
              : 'Workspace is not initialized and n8n credentials are missing. Ask for the missing host or API key, then run init_auth followed by init_project.',
        };
      }

      if (action === 'init_auth') {
        if (!n8nHost || !n8nApiKey) {
          throw new Error('init_auth requires n8nHost and n8nApiKey');
        }

        const result = await runObservedN8nac(observer, ['init-auth', '--host', n8nHost, '--api-key', n8nApiKey], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          next: result.exitCode === 0
            ? 'Credentials saved. Continue with init_project.'
            : 'Initialization auth failed. Inspect stderr and retry with corrected host or API key.',
        };
      }

      if (action === 'init_project') {
        const args = ['init-project', '--sync-folder', syncFolder || 'workflows'];
        if (projectId) {
          args.push('--project-id', projectId);
        } else if (projectName) {
          args.push('--project-name', projectName);
        } else {
          args.push('--project-index', String(projectIndex ?? 1));
        }

        const result = await runObservedN8nac(observer, args, cwd);
        if (result.exitCode !== 0) {
          return {
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            stdout: truncateText(result.stdout),
            stderr: truncateText(result.stderr),
          };
        }

        const refresh = await runObservedN8nac(observer, ['update-ai'], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          aiContextRefreshed: refresh.exitCode === 0,
          aiContextStdout: truncateText(refresh.stdout),
          aiContextStderr: truncateText(refresh.stderr),
          next: refresh.exitCode === 0
            ? 'Workspace initialized and the n8n workspace instructions were refreshed.'
            : 'Workspace initialized, but the n8n workspace instructions refresh failed. Inspect aiContextStderr.',
        };
      }

      if (action === 'list') {
        const args = ['list'];
        if (listScope && listScope !== 'all') {
          args.push(`--${listScope}`);
        }
        const result = await runObservedN8nac(observer, args, cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
        };
      }

      if (action === 'pull') {
        if (!workflowId) {
          throw new Error('pull requires workflowId');
        }
        const result = await runObservedN8nac(observer, ['pull', workflowId], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
        };
      }

      if (action === 'push') {
        if (!filename) {
          throw new Error('push requires filename including .workflow.ts');
        }
        let pushTarget = filename;
        let result = await runObservedN8nac(observer, ['push', pushTarget, '--verify'], cwd);

        if (
          result.exitCode !== 0
          && /local file not found in the active sync scope/i.test(result.stderr || result.stdout)
        ) {
          const preferredCandidate = pickPreferredWorkspaceWorkflowCandidate(filename);
          if (preferredCandidate) {
            pushTarget = relativeWorkspacePath(preferredCandidate);
            await emitToolEvent(observer, {
              type: 'status',
              toolName: 'n8nac',
              message: `Retrying push with workspace path ${pushTarget}`,
            });
            result = await runObservedN8nac(observer, ['push', pushTarget, '--verify'], cwd);
          }
        }

        const host = resolveN8nRuntimeState(new YagrN8nConfigService(), process.env, {
          allowEnvironmentFallback: process.env.YAGR_ALLOW_N8N_ENV === '1',
        }).host;
        const syncFacts = parseWorkflowSyncFacts(result.stdout, result.stderr, host);

        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          pushTarget,
          workflowId: syncFacts.workflowId ?? null,
          workflowUrl: syncFacts.workflowUrl ?? null,
          title: syncFacts.workflowName ?? null,
          verified: result.exitCode === 0 && Boolean(syncFacts.workflowId),
        };
      }

      if (action === 'verify') {
        if (!workflowId) {
          throw new Error('verify requires workflowId');
        }
        const result = await runObservedN8nac(observer, ['verify', workflowId], cwd);
        const host = resolveN8nRuntimeState(new YagrN8nConfigService(), process.env, {
          allowEnvironmentFallback: process.env.YAGR_ALLOW_N8N_ENV === '1',
        }).host;
        const syncFacts = parseWorkflowSyncFacts(result.stdout, result.stderr, host);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          workflowId: syncFacts.workflowId ?? workflowId,
          workflowUrl: syncFacts.workflowUrl ?? null,
          title: syncFacts.workflowName ?? null,
        };
      }

      if (action === 'workflow_activate') {
        if (!workflowId) {
          throw new Error('workflow_activate requires workflowId');
        }

        const result = await runObservedN8nac(observer, ['workflow', 'activate', workflowId], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          workflowId,
        };
      }

      if (action === 'workflow_deactivate') {
        if (!workflowId) {
          throw new Error('workflow_deactivate requires workflowId');
        }

        const result = await runObservedN8nac(observer, ['workflow', 'deactivate', workflowId], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          workflowId,
        };
      }

      if (action === 'workflow_credential_required') {
        if (!workflowId) {
          throw new Error('workflow_credential_required requires workflowId');
        }

        const args = ['workflow', 'credential-required', workflowId];
        if (outputJson !== false) {
          args.push('--json');
        }
        const result = await runObservedN8nac(observer, args, cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          workflowId,
        };
      }

      if (action === 'credential_schema') {
        if (!credentialType) {
          throw new Error('credential_schema requires credentialType');
        }

        const args = ['credential', 'schema', credentialType];
        if (outputJson !== false) {
          args.push('--json');
        }
        const result = await runObservedN8nac(observer, args, cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          credentialType,
        };
      }

      if (action === 'credential_list') {
        const args = ['credential', 'list'];
        if (outputJson !== false) {
          args.push('--json');
        }
        const result = await runObservedN8nac(observer, args, cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
        };
      }

      if (action === 'credential_get') {
        if (!credentialId) {
          throw new Error('credential_get requires credentialId');
        }

        const args = ['credential', 'get', credentialId];
        if (outputJson !== false) {
          args.push('--json');
        }
        const result = await runObservedN8nac(observer, args, cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          credentialId,
        };
      }

      if (action === 'credential_create') {
        if (!credentialType || !credentialName) {
          throw new Error('credential_create requires credentialType and credentialName');
        }
        if (!credentialData && !credentialFile) {
          throw new Error('credential_create requires credentialData or credentialFile');
        }

        const args = ['credential', 'create', '--type', credentialType, '--name', credentialName];
        if (credentialFile) {
          const filePath = relativeWorkspacePath(resolveWorkspacePath(credentialFile));
          args.push('--file', filePath);
        } else if (credentialData) {
          args.push('--data', credentialData);
        }
        if (projectId) {
          args.push('--project-id', projectId);
        }
        if (outputJson !== false) {
          args.push('--json');
        }
        const result = await runObservedN8nac(observer, args, cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          credentialType,
          credentialName,
        };
      }

      if (action === 'credential_delete') {
        if (!credentialId) {
          throw new Error('credential_delete requires credentialId');
        }

        const result = await runObservedN8nac(observer, ['credential', 'delete', credentialId], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          credentialId,
        };
      }

      if (action === 'execution_list') {
        const args = ['execution', 'list'];
        if (workflowId) {
          args.push('--workflow-id', workflowId);
        }
        if (projectId) {
          args.push('--project-id', projectId);
        }
        if (executionStatus) {
          args.push('--status', executionStatus);
        }
        if (executionLimit) {
          args.push('--limit', String(executionLimit));
        }
        if (executionCursor) {
          args.push('--cursor', executionCursor);
        }
        if (includeData) {
          args.push('--include-data');
        }
        if (outputJson !== false) {
          args.push('--json');
        }
        const result = await runObservedN8nac(observer, args, cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
        };
      }

      if (action === 'execution_get') {
        if (!executionId) {
          throw new Error('execution_get requires executionId');
        }

        const args = ['execution', 'get', executionId];
        if (includeData) {
          args.push('--include-data');
        }
        if (outputJson !== false) {
          args.push('--json');
        }
        const result = await runObservedN8nac(observer, args, cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          executionId,
        };
      }

      if (action === 'test_plan') {
        if (!workflowId) {
          throw new Error('test_plan requires workflowId');
        }

        const args = ['test-plan', workflowId];
        if (outputJson !== false) {
          args.push('--json');
        }
        const result = await runObservedN8nac(observer, args, cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          workflowId,
        };
      }

      if (action === 'test') {
        if (!workflowId) {
          throw new Error('test requires workflowId');
        }

        const args = ['test', workflowId];
        if (testProd) {
          args.push('--prod');
        }
        if (testData) {
          args.push('--data', testData);
        }
        if (testQuery) {
          args.push('--query', testQuery);
        }
        const result = await runObservedN8nac(observer, args, cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
          workflowId,
        };
      }

      if (action === 'skills') {
        const argv = Array.isArray(skillsArgv) && skillsArgv.length > 0
          ? skillsArgv
          : skillsArgs
            ? splitArgv(skillsArgs)
            : null;

        if (!argv || argv.length === 0) {
          // Robust fallback for providers that emit an empty skills call.
          const fallback = await runObservedN8nac(observer, ['skills', 'list'], cwd);
          return {
            exitCode: fallback.exitCode,
            timedOut: fallback.timedOut,
            stdout: truncateText(fallback.stdout),
            stderr: truncateText(fallback.stderr),
            note: 'No skills args were provided; defaulted to `n8nac skills list`.',
          };
        }

        const result = await runObservedN8nac(observer, ['skills', ...argv], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
        };
      }

      if (action === 'validate') {
        if (!validateFile) {
          throw new Error('validate requires validateFile');
        }
        const filePath = relativeWorkspacePath(resolveWorkspacePath(validateFile));
        const result = await runObservedN8nac(observer, ['skills', 'validate', filePath], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
        };
      }

      if (action === 'update_ai') {
        const result = await runObservedN8nac(observer, ['update-ai'], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
        };
      }

      if (!workflowId || !resolveMode) {
        throw new Error('resolve requires workflowId and resolveMode');
      }

      const result = await runObservedN8nac(observer, ['resolve', workflowId, '--mode', resolveMode], cwd);
      return {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: truncateText(result.stdout),
        stderr: truncateText(result.stderr),
      };
    },
  });
}
