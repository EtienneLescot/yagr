/**
 * LangChain version of the moveFile tool.
 *
 * deepagents' `FilesystemMiddleware` does not include a move/rename operation,
 * so this tool is injected separately.
 */
import fs from 'node:fs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ensureParentDirectory, fileExists } from '../fs-utils.js';
import { relativeYagrHomePath, resolveYagrHomePath } from '../home-path-utils.js';

export const moveFileTool = tool(
  async ({ fromPath, toPath, overwrite }): Promise<string> => {
    const sourcePath = resolveYagrHomePath(fromPath);
    const targetPath = resolveYagrHomePath(toPath);

    if (sourcePath === targetPath) {
      return JSON.stringify({
        ok: true,
        fromPath: relativeYagrHomePath(sourcePath),
        toPath: relativeYagrHomePath(targetPath),
        note: 'Source and destination are the same path — no-op.',
      });
    }

    if (!fileExists(sourcePath)) {
      return JSON.stringify({
        ok: false,
        fromPath: relativeYagrHomePath(sourcePath),
        toPath: relativeYagrHomePath(targetPath),
        error: `Source file does not exist: ${fromPath}`,
      });
    }

    if (!overwrite && fileExists(targetPath)) {
      return JSON.stringify({
        ok: false,
        fromPath: relativeYagrHomePath(sourcePath),
        toPath: relativeYagrHomePath(targetPath),
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
      fromPath: relativeYagrHomePath(sourcePath),
      toPath: relativeYagrHomePath(targetPath),
    });
  },
  {
    name: 'moveFile',
    description:
      'Move or rename a file under the Yagr home directory. Use this to consolidate provisional artifacts into the correct location before completion.',
    schema: z.object({
      fromPath: z.string().min(1).describe('Current Yagr-home-relative file path.'),
      toPath: z.string().min(1).describe('Target Yagr-home-relative file path.'),
      overwrite: z.boolean().default(false).describe('Whether to overwrite the destination if it already exists.'),
    }),
  },
);