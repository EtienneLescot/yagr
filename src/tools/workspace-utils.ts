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

export function fileExists(targetPath: string): boolean {
  return fs.existsSync(targetPath);
}