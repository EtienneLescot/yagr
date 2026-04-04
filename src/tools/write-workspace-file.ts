import fs from 'node:fs';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { ensureParentDirectory, fileExists, relativeWorkspacePath, resolveWorkspacePath } from './workspace-utils.js';

export function createWriteFileTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'Write a workspace file. Use ONLY for creating brand-new files that do not exist yet. To modify an existing file use replaceInFile — never overwrite an existing file with writeFile, as this discards metadata written by external tools.',
    parameters: z.preprocess((input) => {
      if (!input || typeof input !== 'object') {
        return input;
      }

      const obj = input as Record<string, unknown>;
      return {
        ...obj,
        path: obj.path ?? null,
        content: obj.content ?? null,
      };
    }, z.object({
      path: z.string().min(1).nullable().describe('Workspace-relative file path.'),
      content: z.string().nullable().describe('Full file content to write.'),
      mode: z.enum(['create', 'overwrite', 'append']).default('create').describe('Write mode. Default is "create" — fails if the file already exists. Use "overwrite" only when intentionally replacing a file you have already read in full.'),
    })),
    execute: async ({ path: inputPath, content, mode }) => {
      if (!inputPath || typeof inputPath !== 'string') {
        return {
          ok: false,
          error: 'writeFile requires a workspace-relative path.',
        };
      }

      if (typeof content !== 'string') {
        return {
          ok: false,
          path: inputPath,
          error: 'writeFile requires full file content before the file can be written.',
        };
      }

      const targetPath = resolveWorkspacePath(inputPath);
      const exists = fileExists(targetPath);

      if (mode === 'create' && exists) {
        return {
          ok: false,
          path: relativeWorkspacePath(targetPath),
          error: `File already exists: ${inputPath}`,
        };
      }

      // Guard: overwriting an existing file with writeFile discards any metadata
      // (IDs, generated content) that external tools may have written into it.
      // Require the caller to use replaceInFile for targeted edits instead.
      if (mode === 'overwrite' && exists) {
        return {
          ok: false,
          path: relativeWorkspacePath(targetPath),
          error: `Cannot overwrite existing file ${inputPath} with writeFile. Use replaceInFile to make targeted edits that preserve metadata written by external tools (e.g. IDs, generated fields). Only use writeFile for brand-new files.`,
        };
      }

      ensureParentDirectory(targetPath);

      if (mode === 'append') {
        fs.appendFileSync(targetPath, content, 'utf-8');
      } else {
        fs.writeFileSync(targetPath, content, 'utf-8');
      }

      return {
        ok: true,
        path: relativeWorkspacePath(targetPath),
        mode,
        bytesWritten: Buffer.byteLength(content, 'utf-8'),
      };
    },
  });
}
