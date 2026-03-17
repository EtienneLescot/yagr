import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { emitToolEvent, quoteShellArg, type ToolExecutionObserver } from './observer.js';
import { relativeWorkspacePath, resolveWorkspacePath, truncateText, workspaceRoot } from './workspace-utils.js';

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

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
      env: { ...process.env, ...env },
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
    message: result.exitCode === 0 ? 'Commande terminee.' : 'Commande en echec.',
  });

  return result;
}

function isWorkspaceInitialized(): { initialized: boolean; configPath: string } {
  const configPath = resolveWorkspacePath('n8nac-config.json');
  if (!fs.existsSync(configPath)) {
    return { initialized: false, configPath: relativeWorkspacePath(configPath) };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as { projectId?: string; projectName?: string };
    return {
      initialized: Boolean(config.projectId && config.projectName),
      configPath: relativeWorkspacePath(configPath),
    };
  } catch {
    return { initialized: false, configPath: relativeWorkspacePath(configPath) };
  }
}

export function createN8nAcTool(observer?: ToolExecutionObserver) {
  return tool({
    description: 'Run n8n-as-code workflow operations from the active workspace. Use this for init, list, pull, push, verify, skills search, validation, and AI context refresh.',
    parameters: z.object({
      action: z.enum(['setup_check', 'init_auth', 'init_project', 'list', 'pull', 'push', 'verify', 'skills', 'validate', 'update_ai', 'resolve']),
      n8nHost: z.string().optional().describe('n8n host URL for init_auth.'),
      n8nApiKey: z.string().optional().describe('n8n API key for init_auth.'),
      projectId: z.string().optional().describe('n8n project ID for init_project.'),
      projectName: z.string().optional().describe('n8n project name for init_project.'),
      projectIndex: z.number().int().min(1).optional().describe('1-based project selector for init_project.'),
      listScope: z.enum(['all', 'local', 'remote', 'distant']).optional().describe('Workflow listing scope for list.'),
      workflowId: z.string().optional().describe('Workflow ID for pull, verify, or resolve.'),
      filename: z.string().optional().describe('Workflow filename including .workflow.ts for push.'),
      skillsArgs: z.string().optional().describe('String form of n8nac skills arguments, for example search telegram.'),
      skillsArgv: z.array(z.string()).optional().describe('Array form of n8nac skills arguments when values contain spaces.'),
      validateFile: z.string().optional().describe('Local workflow file path for n8nac skills validate.'),
      syncFolder: z.string().optional().describe('Sync folder to pass to init_project. Defaults to workflows.'),
      resolveMode: z.enum(['keep-current', 'keep-incoming']).optional().describe('Conflict resolution mode for resolve.'),
    }),
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
      const cwd = workspaceRoot();

      if (action === 'setup_check') {
        const status = isWorkspaceInitialized();
        return {
          ...status,
          workspaceRoot: relativeWorkspacePath(cwd),
          next: status.initialized
            ? 'Workspace is initialized. You can list, pull, edit, validate, push, and verify workflows.'
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
            ? 'Workspace initialized and AGENTS.md refreshed.'
            : 'Workspace initialized, but AGENTS.md refresh failed. Inspect aiContextStderr.',
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

        if (!argv) {
          throw new Error('skills requires skillsArgv or a valid skillsArgs string');
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