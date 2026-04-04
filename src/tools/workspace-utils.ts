import fs from 'node:fs';
import path from 'node:path';
import { getYagrN8nWorkspaceDir } from '../config/yagr-home.js';

const DEFAULT_TEXT_LIMIT = 12_000;

export function workspaceRoot(): string {
  return getYagrN8nWorkspaceDir();
}

export function resolveWorkspacePath(targetPath = '.'): string {
  const root = workspaceRoot();
  const resolved = path.resolve(root, targetPath);

  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    return resolved;
  }

  throw new Error(`Path must stay inside the active workspace: ${targetPath}`);
}

export function relativeWorkspacePath(targetPath: string): string {
  const relative = path.relative(workspaceRoot(), targetPath);
  return relative || '.';
}

export function truncateText(text: string, maxLength = DEFAULT_TEXT_LIMIT): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n... [truncated ${text.length - maxLength} chars]`;
}

export function readTextFile(targetPath: string): string {
  return fs.readFileSync(targetPath, 'utf-8');
}

export function ensureParentDirectory(targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let startIndex = 0;

  while (true) {
    const index = haystack.indexOf(needle, startIndex);
    if (index === -1) {
      return count;
    }

    count += 1;
    startIndex = index + needle.length;
  }
}

export function shouldIgnorePath(targetPath: string): boolean {
  const relative = relativeWorkspacePath(targetPath);
  return relative === 'node_modules'
    || relative.startsWith(`node_modules${path.sep}`)
    || relative === '.git'
    || relative.startsWith(`.git${path.sep}`)
    || relative === 'dist'
    || relative.startsWith(`dist${path.sep}`)
    || relative === 'build'
    || relative.startsWith(`build${path.sep}`)
    || relative === '.next'
    || relative.startsWith(`.next${path.sep}`);
}

/**
 * Recursively search the workspace root for files whose name or
 * workspace-relative path matches `filename`.
 *
 * Skips common non-source directories (node_modules, .git, dist, build, etc.)
 * and hidden directories.
 */
export function findFileInWorkspace(filename: string): string[] {
  const root = workspaceRoot();
  const target = filename.trim();
  if (!target) {
    return [];
  }

  const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage', '.cache']);
  const matches: string[] = [];

  const visit = (dirPath: string) => {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        visit(path.join(dirPath, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const entryPath = path.join(dirPath, entry.name);
      if (entry.name === target || relativeWorkspacePath(entryPath) === target) {
        matches.push(entryPath);
      }
    }
  };

  visit(root);
  return matches;
}

export function fileExists(targetPath: string): boolean {
  return fs.existsSync(targetPath);
}

/**
 * Parse JSON from a raw CLI output string.
 *
 * Tries a direct JSON.parse first; if that fails, scans for the first `{` or
 * `[` character and retries from there. This handles CLI tools that prefix
 * their JSON output with status text or ANSI codes.
 *
 * Returns `undefined` if no parseable JSON is found.
 */
export function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.search(/[{[]/);
    if (firstBrace < 0) {
      return undefined;
    }

    const candidate = trimmed.slice(firstBrace);
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
}