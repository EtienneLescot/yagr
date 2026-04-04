import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { emitToolEvent, type ToolExecutionObserver } from './observer.js';
import { workspaceRoot } from './workspace-utils.js';

const MAX_OUTPUT_SIZE = 20_000; // characters

/**
 * Commands allowed to run via runScript.
 * Each entry is matched against the start of the resolved command string.
 * This is an allowlist — anything not matching is rejected.
 */
const ALLOWED_COMMANDS: readonly string[] = [
  // Build & type-check
  'npm run',
  'npm test',
  'npm install',
  'npx tsc',
  'tsc',
  // Test runners
  'node --test',
  'vitest',
  'jest',
  // Git read-only ops
  'git status',
  'git diff',
  'git log',
  'git show',
  'git branch',
  'git remote',
  // Inspection utilities
  'node --version',
  'node -e',
  'cat',
  'ls',
  'find',
  'which',
];

function isAllowedCommand(command: string): boolean {
  const trimmed = command.trim();
  return ALLOWED_COMMANDS.some((allowed) => trimmed === allowed || trimmed.startsWith(`${allowed} `) || trimmed.startsWith(`${allowed}\t`));
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_SIZE) {
    return output;
  }

  return `${output.slice(0, MAX_OUTPUT_SIZE)}\n[... truncated, ${output.length - MAX_OUTPUT_SIZE} chars omitted]`;
}

export function createRunScriptTool(observer?: ToolExecutionObserver) {
  return tool({
    description:
      'Run a shell command from an allowlist of safe, read-oriented operations. ' +
      'Use this to build the project (npm run build), run tests (npm test, node --test), ' +
      'type-check (npx tsc --noEmit), or inspect git state (git diff, git status). ' +
      'Only commands from the approved allowlist are executed; anything else is rejected. ' +
      'Runs in the active workspace directory by default.',
    parameters: z.object({
      command: z.string().min(1).describe('Shell command to run. Must start with an allowlisted prefix.'),
      cwd: z.string().optional().describe('Working directory. Defaults to the active workspace root.'),
      timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000).describe('Timeout in milliseconds (max 120s).'),
    }),
    execute: async ({ command, cwd, timeoutMs }) => {
      if (!isAllowedCommand(command)) {
        return {
          ok: false,
          command,
          error: `Command not in allowlist. Allowed prefixes: ${ALLOWED_COMMANDS.join(', ')}`,
        };
      }

      const workingDir = cwd ?? workspaceRoot();

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
      });
    },
  });
}
