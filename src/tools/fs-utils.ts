import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_TEXT_LIMIT = 12_000;

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

export function fileExists(targetPath: string): boolean {
  return fs.existsSync(targetPath);
}

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