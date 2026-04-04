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

export function createGrepTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'Search text across files. Accepts workspace-relative paths by default. Set absolute=true to search in any directory on the filesystem by its absolute path.',
    parameters: z.object({
      query: z.string().min(1).describe('Plain-text or regular-expression search query.'),
      path: z.string().default('.').describe('Workspace-relative root path to search in, or an absolute path when absolute=true.'),
      isRegexp: z.boolean().default(false).describe('Interpret query as a JavaScript regular expression.'),
      maxResults: z.number().int().min(1).max(200).default(50).describe('Maximum number of matches to return.'),
      absolute: z.boolean().default(false).describe('When true, treat path as an absolute filesystem path instead of workspace-relative.'),
    }),
    execute: async ({ query, path: inputPath, isRegexp, maxResults, absolute }) => {
      const targetPath = absolute ? path.resolve(inputPath) : resolveWorkspacePath(inputPath);
      try {
        fs.statSync(targetPath);
      } catch (error) {
        return {
          query,
          matches: [],
          ok: false,
          path: inputPath,
          error: error instanceof Error ? error.message : String(error),
        };
      }

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
        ok: true,
        path: absolute ? targetPath : relativeWorkspacePath(targetPath),
        query,
        matches,
      };
    },
  });
}