import fs from 'node:fs';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { relativeWorkspacePath, resolveWorkspacePath, shouldIgnorePath } from './workspace-utils.js';

function collectEntries(targetPath: string, recursive: boolean, maxDepth: number, depth = 0): Array<{ path: string; type: 'file' | 'directory' }> {
  const entries = fs.readdirSync(targetPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const results: Array<{ path: string; type: 'file' | 'directory' }> = [];

  for (const entry of entries) {
    const absolutePath = path.join(targetPath, entry.name);
    if (shouldIgnorePath(absolutePath)) {
      continue;
    }

    results.push({
      path: relativeWorkspacePath(absolutePath),
      type: entry.isDirectory() ? 'directory' : 'file',
    });

    if (recursive && entry.isDirectory() && depth < maxDepth) {
      results.push(...collectEntries(absolutePath, true, maxDepth, depth + 1));
    }
  }

  return results;
}

export function createListDirTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'List files and directories. Accepts workspace-relative paths by default. Set absolute=true to list any directory on the filesystem by its absolute path.',
    parameters: z.object({
      path: z.string().default('.').describe('Workspace-relative directory path to inspect, or an absolute path when absolute=true.'),
      recursive: z.boolean().default(false).describe('Whether to walk subdirectories.'),
      maxDepth: z.number().int().min(0).max(6).default(2).describe('Maximum recursion depth when recursive is true.'),
      absolute: z.boolean().default(false).describe('When true, treat path as an absolute filesystem path instead of workspace-relative.'),
    }),
    execute: async ({ path: inputPath, recursive, maxDepth, absolute }) => {
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

      if (!stats.isDirectory()) {
        return {
          ok: false,
          path: absolute ? targetPath : relativeWorkspacePath(targetPath),
          error: `Path is not a directory: ${inputPath}`,
        };
      }

      const displayPath = absolute ? targetPath : relativeWorkspacePath(targetPath);

      return {
        ok: true,
        path: displayPath,
        entries: collectEntries(targetPath, recursive, maxDepth),
      };
    },
  });
}