import type { YagrRunJournalEntry } from '../types.js';

export type RunOutcome = {
  writtenFiles: string[];
  updatedFiles: string[];
  deletedFiles: string[];
  hasWorkflowWrites: boolean;
  /** Number of runScript calls that exited 0. */
  successfulScriptRuns: number;
  /** Number of runScript calls that exited non-0. */
  failedScriptRuns: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function analyzeRunOutcome(journal: YagrRunJournalEntry[]): RunOutcome {
  const writtenFiles = new Set<string>();
  const updatedFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  let successfulScriptRuns = 0;
  let failedScriptRuns = 0;

  for (const entry of journal) {
    if (entry.type !== 'step' || !entry.step) {
      continue;
    }

    const step = entry.step;

    for (let index = 0; index < step.toolCalls.length; index += 1) {
      const toolCall = step.toolCalls[index];
      const toolResult = step.toolResults[index];
      const args = asRecord(toolCall.args);
      const result = asRecord(toolResult?.result);

      if (toolCall.toolName === 'writeFile') {
        const filePath = asString(result?.path) ?? asString(args?.path);
        if (filePath) writtenFiles.add(filePath);
        continue;
      }

      if (toolCall.toolName === 'replaceInFile') {
        const filePath = asString(result?.path) ?? asString(args?.path);
        if (filePath) updatedFiles.add(filePath);
        continue;
      }

      if (toolCall.toolName === 'deleteFile') {
        const filePath = asString(result?.path) ?? asString(args?.path);
        if (result?.deleted === true && filePath) deletedFiles.add(filePath);
        continue;
      }

      if (toolCall.toolName === 'runScript') {
        const exitCode = asNumber(result?.exitCode) ?? 1;
        if (exitCode === 0) {
          successfulScriptRuns += 1;
        } else {
          failedScriptRuns += 1;
        }
      }
    }
  }

  const allWritten = [...writtenFiles, ...updatedFiles];
  const hasWorkflowWrites = allWritten.some((f) => f.endsWith('.workflow.ts'));

  return {
    writtenFiles: [...writtenFiles],
    updatedFiles: [...updatedFiles],
    deletedFiles: [...deletedFiles],
    hasWorkflowWrites,
    successfulScriptRuns,
    failedScriptRuns,
  };
}
