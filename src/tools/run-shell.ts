import { spawn } from 'node:child_process';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { emitToolEvent, type ToolExecutionObserver } from './observer.js';

const MAX_OUTPUT_SIZE = 20_000;

/**
 * Environment variable that must be set to '1' to enable runShell.
 * This opt-in prevents accidental shell access in default deployments.
 */
export const YAGR_ENABLE_SHELL_ENV = 'YAGR_ENABLE_SHELL';

export function isShellEnabled(): boolean {
  return process.env[YAGR_ENABLE_SHELL_ENV] === '1';
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_SIZE) {
    return output;
  }

  return `${output.slice(0, MAX_OUTPUT_SIZE)}\n[... truncated, ${output.length - MAX_OUTPUT_SIZE} chars omitted]`;
}

export function createRunShellTool(observer?: ToolExecutionObserver) {
  return new DynamicStructuredTool({
    name: 'runShell',
    description:
      '⚠️  UNRESTRICTED SHELL — runs any command in a bash subprocess. ' +
      'This tool is DISABLED by default and requires the YAGR_ENABLE_SHELL=1 environment variable to be set by the user. ' +
      'When enabled, it can execute arbitrary commands including destructive ones (rm, git push, etc.). ' +
      'Use runScript for safe, allowlist-controlled operations. ' +
      'Only use runShell when runScript is insufficient and the user has explicitly opted in.',
    schema: z.object({
      command: z.string().min(1).describe('Shell command to execute.'),
      cwd: z.string().optional().describe('Working directory. Defaults to the current process directory.'),
      timeoutMs: z.number().int().min(1_000).max(300_000).default(30_000).describe('Timeout in milliseconds (max 5 minutes).'),
    }),
    func: async ({ command, cwd, timeoutMs }) => {
      if (!isShellEnabled()) {
        return JSON.stringify({
          ok: false,
          command,
          error:
            'runShell is disabled. Set YAGR_ENABLE_SHELL=1 to opt in. ' +
            'Warning: this grants the agent unrestricted shell access. ' +
            'Consider using runScript for safe allowlisted operations instead.',
        });
      }

      await emitToolEvent(observer, {
        type: 'status',
        toolName: 'runShell',
        message: `$ ${command}`,
      });

      return new Promise((resolve) => {
        const child = spawn('bash', ['-c', command], {
          cwd: cwd ?? process.cwd(),
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
