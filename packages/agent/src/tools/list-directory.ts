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

export function createListDirectoryTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'List files and directories in the active workspace. Use this to discover workflow folders before editing files.',
    parameters: z.object({
      path: z.string().default('.').describe('Workspace-relative directory path to inspect.'),
      recursive: z.boolean().default(false).describe('Whether to walk subdirectories.'),
      maxDepth: z.number().int().min(0).max(6).default(2).describe('Maximum recursion depth when recursive is true.'),
    }),
    execute: async ({ path: inputPath, recursive, maxDepth }) => {
      const targetPath = resolveWorkspacePath(inputPath);
      const stats = fs.statSync(targetPath);

      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${inputPath}`);
      }

      return {
        path: relativeWorkspacePath(targetPath),
        entries: collectEntries(targetPath, recursive, maxDepth),
      };
    },
  });
}