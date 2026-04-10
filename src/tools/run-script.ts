import { spawn } from 'node:child_process';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { emitToolEvent, type ToolExecutionObserver } from './observer.js';
import { getYagrHomeDir } from '../config/yagr-home.js';
import type { YagrShellCommandsConfig } from '../config/yagr-config-service.js';

const MAX_OUTPUT_SIZE = 20_000; // characters

function matchesApprovedPrefix(command: string, approved: string[]): boolean {
  const trimmed = command.trim();
  return approved.some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `) || trimmed.startsWith(`${prefix}\t`));
}

function isCommandAllowed(command: string, config: YagrShellCommandsConfig | undefined): { allowed: boolean; reason?: string } {
  const mode = config?.mode ?? 'allow-all';

  if (mode === 'allow-all') {
    return { allowed: true };
  }

  // user-approved: check against approved prefixes
  const approved = config?.approved ?? [];
  if (approved.length === 0) {
    return { allowed: false, reason: 'No approved commands configured. Add command prefixes to shellCommands.approved in your Yagr config, or switch to allow-all mode.' };
  }

  if (!matchesApprovedPrefix(command, approved)) {
    return { allowed: false, reason: `Command not in approved list. Approved prefixes: ${approved.join(', ')}` };
  }

  return { allowed: true };
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_SIZE) {
    return output;
  }

  return `${output.slice(0, MAX_OUTPUT_SIZE)}\n[... truncated, ${output.length - MAX_OUTPUT_SIZE} chars omitted]`;
}

export function createRunScriptTool(observer?: ToolExecutionObserver, shellCommandsConfig?: YagrShellCommandsConfig) {
  const mode = shellCommandsConfig?.mode ?? 'allow-all';
  const modeDescription = mode === 'allow-all'
    ? 'All shell commands are allowed (allow-all mode).'
    : `Only user-approved command prefixes are allowed (user-approved mode). Approved: ${(shellCommandsConfig?.approved ?? []).join(', ') || 'none configured'}.`;

  return new DynamicStructuredTool({
    name: 'runScript',
    description:
      'Run a shell command from the Yagr home directory by default. ' +
      'Use this to build the project, run tests, inspect files, manage git, or execute any necessary tool. ' +
      modeDescription +
      ' Runs in the Yagr home directory unless cwd is provided.',
    schema: z.object({
      command: z.string().min(1).describe('Shell command to run.'),
      cwd: z.string().optional().describe('Working directory. Defaults to the active workspace root.'),
      timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000).describe('Timeout in milliseconds (max 120s).'),
    }),
    func: async ({ command, cwd, timeoutMs }) => {
      const check = isCommandAllowed(command, shellCommandsConfig);
      if (!check.allowed) {
        return JSON.stringify({
          ok: false,
          command,
          error: check.reason ?? 'Command not allowed.',
        });
      }

      const workingDir = cwd ?? getYagrHomeDir();

      await emitToolEvent(observer, {
        type: 'status',
        toolName: 'runScript',
        message: `$ ${command}`,
      });

      return new Promise((resolve) => {
        const child = spawn('sh', ['-c', command], {
          cwd: workingDir,
          stdio: 'pipe',
          env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;

        const finish = (exitCode: number | null) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);

          resolve({
            ok: exitCode === 0,
            command,
            exitCode,
            timedOut,
            stdout: truncateOutput(stdout),
            stderr: truncateOutput(stderr),
            truncated: stdout.length > MAX_OUTPUT_SIZE || stderr.length > MAX_OUTPUT_SIZE,
          });
        };

        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 2_000);
          finish(null);
        }, timeoutMs);

        child.once('error', (err) => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolve({
              ok: false,
              command,
              exitCode: null,
              timedOut: false,
              stdout: '',
              stderr: '',
              error: err.message,
            });
          }
        });

        child.once('exit', (code) => finish(code));
      }).then((result) => JSON.stringify(result));
    },
  });
}
