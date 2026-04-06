/**
 * LangChain version of the moveFile tool.
 *
 * deepagents' `FilesystemMiddleware` does not include a move/rename operation,
 * so this tool is injected separately.
 */
import fs from 'node:fs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ensureParentDirectory, fileExists, relativeWorkspacePath, resolveWorkspacePath } from '../workspace-utils.js';

export const moveFileTool = tool(
  async ({ fromPath, toPath, overwrite }): Promise<string> => {
    const sourcePath = resolveWorkspacePath(fromPath);
    const targetPath = resolveWorkspacePath(toPath);

    if (sourcePath === targetPath) {
      return JSON.stringify({
        ok: true,
        fromPath: relativeWorkspacePath(sourcePath),
        toPath: relativeWorkspacePath(targetPath),
        note: 'Source and destination are the same path — no-op.',
      });
    }

    if (!fileExists(sourcePath)) {
      return JSON.stringify({
        ok: false,
        fromPath: relativeWorkspacePath(sourcePath),
        toPath: relativeWorkspacePath(targetPath),
        error: `Source file does not exist: ${fromPath}`,
      });
    }

    if (!overwrite && fileExists(targetPath)) {
      return JSON.stringify({
        ok: false,
        fromPath: relativeWorkspacePath(sourcePath),
        toPath: relativeWorkspacePath(targetPath),
        error: `Destination already exists: ${toPath}`,
      });
    }

    ensureParentDirectory(targetPath);
    if (overwrite && fileExists(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }

    fs.renameSync(sourcePath, targetPath);

    return JSON.stringify({
      ok: true,
      fromPath: relativeWorkspacePath(sourcePath),
      toPath: relativeWorkspacePath(targetPath),
    });
  },
  {
    name: 'moveFile',
    description:
      'Move or rename a workspace file to a canonical path. Use this to consolidate provisional artifacts into the correct location before completion.',
    schema: z.object({
      fromPath: z.string().min(1).describe('Current workspace-relative file path.'),
      toPath: z.string().min(1).describe('Target workspace-relative file path.'),
      overwrite: z.boolean().default(false).describe('Whether to overwrite the destination if it already exists.'),
    }),
  },
);
