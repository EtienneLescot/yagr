import fs from 'node:fs';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { readTextFile, relativeWorkspacePath, resolveWorkspacePath, truncateText } from './workspace-utils.js';

export function createReadFileTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'Read a file, optionally by line range. Accepts workspace-relative paths by default. Set absolute=true to read any file on the filesystem by its absolute path.',
    parameters: z.object({
      path: z.string().min(1).describe('Workspace-relative file path, or an absolute path when absolute=true.'),
      startLine: z.number().int().min(1).optional().describe('1-based inclusive start line.'),
      endLine: z.number().int().min(1).optional().describe('1-based inclusive end line.'),
      absolute: z.boolean().default(false).describe('When true, treat path as an absolute filesystem path instead of workspace-relative.'),
    }),
    execute: async ({ path: inputPath, startLine, endLine, absolute }) => {
      const targetPath = absolute ? path.resolve(inputPath) : resolveWorkspacePath(inputPath);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(targetPath);
      } catch (error) {
        return {
          ok: false,
          path: inputPath,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (!stats.isFile()) {
        return {
          ok: false,
          path: absolute ? targetPath : relativeWorkspacePath(targetPath),
          error: `Path is not a file: ${inputPath}`,
        };
      }

      const text = readTextFile(targetPath);
      const lines = text.split(/\r?\n/);
      const from = startLine ?? 1;
      const to = endLine ?? lines.length;
      const selected = lines.slice(from - 1, to).join('\n');

      const displayPath = absolute ? targetPath : relativeWorkspacePath(targetPath);

      return {
        ok: true,
        path: displayPath,
        startLine: from,
        endLine: Math.min(to, lines.length),
        totalLines: lines.length,
        content: truncateText(selected),
      };
    },
  });
}