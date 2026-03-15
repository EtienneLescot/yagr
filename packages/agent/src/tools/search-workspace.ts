import fs from 'node:fs';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { readTextFile, relativeWorkspacePath, resolveWorkspacePath, shouldIgnorePath, truncateText, workspaceRoot } from './workspace-utils.js';

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

function visitFiles(targetPath: string, results: string[]): void {
  if (shouldIgnorePath(targetPath)) {
    return;
  }

  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    results.push(targetPath);
    return;
  }

  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    visitFiles(path.join(targetPath, entry.name), results);
  }
}

export function createSearchWorkspaceTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'Search text across workspace files. Use this to find workflow names, maps, node properties, or n8nac config entries.',
    parameters: z.object({
      query: z.string().min(1).describe('Plain-text or regular-expression search query.'),
      path: z.string().default('.').describe('Workspace-relative root path to search in.'),
      isRegexp: z.boolean().default(false).describe('Interpret query as a JavaScript regular expression.'),
      maxResults: z.number().int().min(1).max(200).default(50).describe('Maximum number of matches to return.'),
    }),
    execute: async ({ query, path: inputPath, isRegexp, maxResults }) => {
      const targetPath = resolveWorkspacePath(inputPath);
      const files: string[] = [];
      visitFiles(targetPath, files);

      const matcher = isRegexp ? new RegExp(query, 'i') : null;
      const matches: SearchMatch[] = [];

      for (const filePath of files) {
        if (matches.length >= maxResults) {
          break;
        }

        if (path.relative(workspaceRoot(), filePath).startsWith('node_modules')) {
          continue;
        }

        let text: string;
        try {
          text = readTextFile(filePath);
        } catch {
          continue;
        }

        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          const found = matcher ? matcher.test(line) : line.toLowerCase().includes(query.toLowerCase());
          if (!found) {
            continue;
          }

          matches.push({
            path: relativeWorkspacePath(filePath),
            line: index + 1,
            text: truncateText(line, 300),
          });

          if (matches.length >= maxResults) {
            break;
          }
        }
      }

      return {
        query,
        matches,
      };
    },
  });
}