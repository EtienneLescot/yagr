import fs from 'node:fs';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { fileExists, relativeWorkspacePath, resolveWorkspacePath } from './workspace-utils.js';

export function createDeleteWorkspaceFileTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'Delete a workspace file that is obsolete, orphaned, or superseded by a canonical copy. Use only when you can attribute the artifact to the current run or prove it is redundant.',
    parameters: z.object({
      path: z.string().min(1).describe('Workspace-relative file path.'),
      allowMissing: z.boolean().default(true).describe('Whether missing files should be treated as a non-fatal result.'),
    }),
    execute: async ({ path: inputPath, allowMissing }) => {
      const targetPath = resolveWorkspacePath(inputPath);

      if (!fileExists(targetPath)) {
        return {
          ok: allowMissing,
          path: relativeWorkspacePath(targetPath),
          deleted: false,
          error: allowMissing ? undefined : `File does not exist: ${inputPath}`,
        };
      }

      fs.rmSync(targetPath, { force: true });

      return {
        ok: true,
        path: relativeWorkspacePath(targetPath),
        deleted: true,
      };
    },
  });
}