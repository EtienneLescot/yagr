import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
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

export function buildYagrCleanupPlan(scope: YagrResetScope = 'config+creds'): YagrCleanupPlan {
  const paths = getYagrPaths();
  const configPaths = uniquePaths([paths.yagrConfigPath]);
  const credentialPaths = uniquePaths([paths.yagrCredentialsPath]);

  let deletePaths: string[];
  switch (scope) {
    case 'config':
      deletePaths = [...configPaths];
      break;
    case 'config+creds':
      deletePaths = [...configPaths, ...credentialPaths];
      break;
    case 'full':
      deletePaths = [paths.homeDir];
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
    deletePaths,
    workspacePaths: [],
    preservedWorkspacePaths: [],
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
      if (fs.existsSync(targetPath)) {
        await removePath(targetPath);
      }
    }
  }

  return {
    plan,
    removedPaths: [...plan.deletePaths],
  };
}
