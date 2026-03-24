import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { YagrN8nConfigService, resolveN8nRuntimeState, resolveWorkflowDir, type YagrN8nLocalConfig } from '../config/n8n-config-service.js';
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
  'skills',
  'validate',
  'update_ai',
  'resolve',
  'skillsArgs',
  'skillsArgv',
] as const;

type N8nAcAction = typeof N8NAC_ACTIONS[number];

function normalizeN8nAcAction(action: N8nAcAction): Exclude<N8nAcAction, 'skillsArgs' | 'skillsArgv'> {
  if (action === 'skillsArgs' || action === 'skillsArgv') {
    return 'skills';
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

  const matches: string[] = [];
  const visit = (dirPath: string) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

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
    return {
      ...obj,
      n8nHost: obj.n8nHost ?? null,
      n8nApiKey: obj.n8nApiKey ?? null,
      projectId: obj.projectId ?? null,
      projectName: obj.projectName ?? null,
      projectIndex: obj.projectIndex ?? null,
      listScope: obj.listScope ?? null,
      workflowId: obj.workflowId ?? null,
      filename: obj.filename ?? null,
      skillsArgs: obj.skillsArgs ?? null,
      skillsArgv: obj.skillsArgv ?? null,
      validateFile: obj.validateFile ?? null,
      syncFolder: obj.syncFolder ?? null,
      resolveMode: obj.resolveMode ?? null,
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
  }));

  return tool({
    description: 'Run n8n-as-code workflow operations from the active workspace. For skills queries, use action="skills" with either skillsArgs as a single shell-like string or skillsArgv as an array of arguments.',
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
    }) => {
      action = normalizeN8nAcAction(action);
      const cwd = workspaceRoot();

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
