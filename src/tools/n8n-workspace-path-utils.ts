import path from 'node:path';
import { getYagrN8nWorkspaceDir } from '../config/yagr-home.js';

export function n8nWorkspaceRoot(): string {
  return getYagrN8nWorkspaceDir();
}

export function resolveN8nWorkspacePath(targetPath = '.'): string {
  const root = n8nWorkspaceRoot();
  const resolved = path.resolve(root, targetPath);

  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    return resolved;
  }

  throw new Error(`Path must stay inside n8n-workspace: ${targetPath}`);
}

export function relativeN8nWorkspacePath(targetPath: string): string {
  const relative = path.relative(n8nWorkspaceRoot(), targetPath);
  return relative || '.';
}