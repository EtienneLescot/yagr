import fs from 'node:fs';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { ensureParentDirectory, fileExists, relativeWorkspacePath, resolveWorkspacePath } from './workspace-utils.js';

export function createMoveWorkspaceFileTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'Move or rename a workspace file to a canonical path. Use this to consolidate provisional artifacts into the correct location before completion.',
    parameters: z.object({
      fromPath: z.string().min(1).describe('Current workspace-relative file path.'),
      toPath: z.string().min(1).describe('Target workspace-relative file path.'),
      overwrite: z.boolean().default(false).describe('Whether to overwrite the destination if it already exists.'),
    }),
    execute: async ({ fromPath, toPath, overwrite }) => {
      const sourcePath = resolveWorkspacePath(fromPath);
      const targetPath = resolveWorkspacePath(toPath);

      if (!fileExists(sourcePath)) {
        return {
          ok: false,
          fromPath: relativeWorkspacePath(sourcePath),
          toPath: relativeWorkspacePath(targetPath),
          error: `Source file does not exist: ${fromPath}`,
        };
      }

      if (!overwrite && fileExists(targetPath)) {
        return {
          ok: false,
          fromPath: relativeWorkspacePath(sourcePath),
          toPath: relativeWorkspacePath(targetPath),
          error: `Destination already exists: ${toPath}`,
        };
      }

      ensureParentDirectory(targetPath);
      if (overwrite && fileExists(targetPath)) {
        fs.rmSync(targetPath, { force: true });
      }

      fs.renameSync(sourcePath, targetPath);

      return {
        ok: true,
        fromPath: relativeWorkspacePath(sourcePath),
        toPath: relativeWorkspacePath(targetPath),
      };
    },
  });
}