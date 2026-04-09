import path from 'node:path';
import { getYagrHomeDir } from '../config/yagr-home.js';

export function yagrHomeRoot(): string {
  return getYagrHomeDir();
}

export function resolveYagrHomePath(targetPath = '.'): string {
  const root = yagrHomeRoot();
  const resolved = path.resolve(root, targetPath);

  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    return resolved;
  }

  throw new Error(`Path must stay inside the Yagr home: ${targetPath}`);
}

export function relativeYagrHomePath(targetPath: string): string {
  const relative = path.relative(yagrHomeRoot(), targetPath);
  return relative || '.';
}