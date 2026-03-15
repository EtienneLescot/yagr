import fs from 'node:fs';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { readTextFile, relativeWorkspacePath, resolveWorkspacePath, truncateText } from './workspace-utils.js';

export function createReadWorkspaceFileTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'Read a workspace file, optionally by line range. Use this before editing workflow TypeScript files.',
    parameters: z.object({
      path: z.string().min(1).describe('Workspace-relative file path.'),
      startLine: z.number().int().min(1).optional().describe('1-based inclusive start line.'),
      endLine: z.number().int().min(1).optional().describe('1-based inclusive end line.'),
    }),
    execute: async ({ path: inputPath, startLine, endLine }) => {
      const targetPath = resolveWorkspacePath(inputPath);
      const stats = fs.statSync(targetPath);

      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${inputPath}`);
      }

      const text = readTextFile(targetPath);
      const lines = text.split(/\r?\n/);
      const from = startLine ?? 1;
      const to = endLine ?? lines.length;
      const selected = lines.slice(from - 1, to).join('\n');

      return {
        path: relativeWorkspacePath(targetPath),
        startLine: from,
        endLine: Math.min(to, lines.length),
        totalLines: lines.length,
        content: truncateText(selected),
      };
    },
  });
}