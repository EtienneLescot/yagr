import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { YagrN8nConfigService, resolveWorkflowDir, type YagrN8nLocalConfig } from '../config/n8n-config-service.js';
import { emitToolEvent, quoteShellArg, type ToolExecutionObserver } from './observer.js';
import { relativeWorkspacePath, resolveWorkspacePath, truncateText, workspaceRoot } from './workspace-utils.js';

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
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
    const child = spawn('npx', ['--yes', 'n8nac', ...args], {
      cwd,
      env: { ...process.env, ...getN8nacProcessEnv(env) },
      stdio: 'pipe',
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

  if (nextEnv.N8N_HOST && nextEnv.N8N_API_KEY) {
    return nextEnv;
  }

  const localConfig = configService.getLocalConfig();
  const host = localConfig.host?.trim();
  if (!host) {
    return nextEnv;
  }

  const apiKey = configService.getApiKey(host);
  if (!apiKey) {
    return nextEnv;
  }

  if (!nextEnv.N8N_HOST) {
    nextEnv.N8N_HOST = host;
  }

  if (!nextEnv.N8N_API_KEY) {
    nextEnv.N8N_API_KEY = apiKey;
  }

  return nextEnv;
}

async function runObservedN8nac(
  observer: ToolExecutionObserver | undefined,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<RunResult> {
  const command = ['npx', '--yes', 'n8nac', ...args].map(quoteShellArg).join(' ');

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
    message: result.exitCode === 0 ? 'Commande terminee.' : 'Correcting commands...',
  });

  return result;
}

function isWorkspaceInitialized(): { initialized: boolean; configPath: string; workflowDir?: string } {
  const configPath = resolveWorkspacePath('n8nac-config.json');
  if (!fs.existsSync(configPath)) {
    return { initialized: false, configPath: relativeWorkspacePath(configPath) };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as YagrN8nLocalConfig;
    const workflowDir = resolveWorkflowDir(config);
    return {
      initialized: Boolean(config.projectId && config.projectName),
      configPath: relativeWorkspacePath(configPath),
      workflowDir: workflowDir ? relativeWorkspacePath(workflowDir) : undefined,
    };
  } catch {
    return { initialized: false, configPath: relativeWorkspacePath(configPath) };
  }
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
            : 'Workspace is not initialized. Ask for missing n8n credentials, then run init_auth followed by init_project.',
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
        const result = await runObservedN8nac(observer, ['push', filename, '--verify'], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
        };
      }

      if (action === 'verify') {
        if (!workflowId) {
          throw new Error('verify requires workflowId');
        }
        const result = await runObservedN8nac(observer, ['verify', workflowId], cwd);
        return {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: truncateText(result.stdout),
          stderr: truncateText(result.stderr),
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
