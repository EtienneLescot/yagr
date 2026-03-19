import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { YagrN8nConfigService } from './n8n-config-service.js';
import { getYagrPaths, type YagrPaths } from './yagr-home.js';

export type YagrResetScope = 'config' | 'config+creds' | 'full';

export interface YagrCleanupPlan {
  scope: YagrResetScope;
  paths: YagrPaths;
  configPaths: string[];
  credentialPaths: string[];
  deletePaths: string[];
  workspacePaths: string[];
  preservedWorkspacePaths: string[];
}

function uniquePaths(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isPathWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function collapsePaths(values: string[]): string[] {
  const normalized = uniquePaths(values).sort((left, right) => left.length - right.length);
  return normalized.filter((candidate, index) => {
    return !normalized.slice(0, index).some((parent) => parent !== candidate && isPathWithin(candidate, parent));
  });
}

function resolveWorkspacePaths(paths: YagrPaths): { workspacePaths: string[]; preservedWorkspacePaths: string[] } {
  const n8nConfig = new YagrN8nConfigService().getLocalConfig();
  if (!n8nConfig.syncFolder) {
    return { workspacePaths: [], preservedWorkspacePaths: [] };
  }

  const resolvedSyncFolder = path.isAbsolute(n8nConfig.syncFolder)
    ? n8nConfig.syncFolder
    : path.resolve(paths.n8nWorkspaceDir, n8nConfig.syncFolder);

  if (isPathWithin(resolvedSyncFolder, paths.n8nWorkspaceDir)) {
    return { workspacePaths: [resolvedSyncFolder], preservedWorkspacePaths: [] };
  }

  return { workspacePaths: [], preservedWorkspacePaths: [resolvedSyncFolder] };
}

export function buildYagrCleanupPlan(scope: YagrResetScope = 'config+creds'): YagrCleanupPlan {
  const paths = getYagrPaths();
  const configPaths = uniquePaths([paths.yagrConfigPath, paths.n8nConfigPath]);
  const credentialPaths = uniquePaths([
    paths.yagrCredentialsPath,
    paths.n8nCredentialsPath,
    paths.legacyYagrCredentialsDir,
    paths.legacyN8nCredentialsDir,
  ]);
  const { workspacePaths, preservedWorkspacePaths } = resolveWorkspacePaths(paths);

  let deletePaths: string[];
  switch (scope) {
    case 'config':
      deletePaths = [...configPaths];
      break;
    case 'config+creds':
      deletePaths = [...configPaths, ...credentialPaths];
      break;
    case 'full':
      deletePaths = [paths.homeDir, paths.legacyYagrCredentialsDir, paths.legacyN8nCredentialsDir];
      break;
    default:
      deletePaths = [...configPaths, ...credentialPaths];
      break;
  }

  return {
    scope,
    paths,
    configPaths,
    credentialPaths,
    deletePaths: collapsePaths(deletePaths),
    workspacePaths,
    preservedWorkspacePaths,
  };
}

export interface YagrResetResult {
  plan: YagrCleanupPlan;
  removedPaths: string[];
}

async function removePath(targetPath: string): Promise<void> {
  await fsPromises.rm(targetPath, { recursive: true, force: true });
}

export async function resetYagrLocalState(scope: YagrResetScope, options: { dryRun?: boolean } = {}): Promise<YagrResetResult> {
  const plan = buildYagrCleanupPlan(scope);
  if (!options.dryRun) {
    for (const targetPath of plan.deletePaths) {
      await removePath(targetPath);
    }
  }

  return {
    plan,
    removedPaths: [...plan.deletePaths],
  };
}