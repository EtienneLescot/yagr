import fs from 'node:fs';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { countOccurrences, readTextFile, relativeWorkspacePath, resolveWorkspacePath } from './workspace-utils.js';

export function createReplaceInWorkspaceFileTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'Replace exact text in a workspace file. Prefer this for focused edits to existing workflow TypeScript files.',
    parameters: z.object({
      path: z.string().min(1).describe('Workspace-relative file path.'),
      oldText: z.string().min(1).describe('Exact text to replace.'),
      newText: z.string().describe('Replacement text.'),
      replaceAll: z.boolean().default(false).describe('Replace every occurrence instead of requiring exactly one match.'),
    }),
    execute: async ({ path: inputPath, oldText, newText, replaceAll }) => {
      const targetPath = resolveWorkspacePath(inputPath);
      const original = readTextFile(targetPath);
      const occurrences = countOccurrences(original, oldText);

      if (occurrences === 0) {
        return {
          ok: false,
          path: relativeWorkspacePath(targetPath),
          error: `Text not found in ${inputPath}`,
        };
      }

      if (!replaceAll && occurrences !== 1) {
        return {
          ok: false,
          path: relativeWorkspacePath(targetPath),
          error: `Expected exactly 1 match in ${inputPath}, found ${occurrences}`,
          occurrences,
        };
      }

      const updated = replaceAll
        ? original.split(oldText).join(newText)
        : original.replace(oldText, newText);

      fs.writeFileSync(targetPath, updated, 'utf-8');

      return {
        ok: true,
        path: relativeWorkspacePath(targetPath),
        occurrences,
        replaced: replaceAll ? occurrences : 1,
      };
    },
  });
}