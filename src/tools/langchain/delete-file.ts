/**
 * LangChain version of the deleteFile tool.
 *
 * deepagents' `FilesystemMiddleware` does not include a delete operation,
 * so this tool is injected separately.
 */
import fs from 'node:fs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { fileExists } from '../fs-utils.js';
import { relativeYagrHomePath, resolveYagrHomePath } from '../home-path-utils.js';

export const deleteFileTool = tool(
  async ({ path: inputPath, allowMissing }): Promise<string> => {
    const targetPath = resolveYagrHomePath(inputPath);

    if (!fileExists(targetPath)) {
      return JSON.stringify({
        ok: allowMissing,
        path: relativeYagrHomePath(targetPath),
        deleted: false,
        error: allowMissing ? undefined : `File does not exist: ${inputPath}`,
      });
    }

    fs.rmSync(targetPath, { force: true });

    return JSON.stringify({
      ok: true,
      path: relativeYagrHomePath(targetPath),
      deleted: true,
    });
  },
  {
    name: 'deleteFile',
    description:
      'Delete a file under the Yagr home directory. Use when the user explicitly requests deletion, or when a file is obsolete, orphaned, or superseded by a canonical copy.',
    schema: z.object({
      path: z.string().min(1).describe('Yagr-home-relative file path.'),
      allowMissing: z.boolean().default(true).describe('Whether missing files should be treated as a non-fatal result.'),
    }),
  },
);