import path from 'node:path';

import { createProjectSlug } from 'n8nac';

import { defineYagrPlugin } from '@yagr/plugin-runtime';

export type YagrN8nInstanceProfile =
  | 'yagr-managed-docker'
  | 'yagr-managed-direct'
  | 'custom-local-docker'
  | 'custom-local-direct'
  | 'custom-cloud';

export interface YagrN8nLocalConfigShape {
  host?: string;
  syncFolder?: string;
  projectId?: string;
  projectName?: string;
  instanceIdentifier?: string;
  customNodesPath?: string;
  instanceProfile?: YagrN8nInstanceProfile;
}

export function resolveManagerWorkflowDir(
  config: YagrN8nLocalConfigShape,
  workspaceDir: string,
): string | undefined {
  const { syncFolder, instanceIdentifier, projectName } = config;
  if (!syncFolder || !instanceIdentifier || !projectName) {
    return undefined;
  }

  const resolvedSyncFolder = path.isAbsolute(syncFolder)
    ? syncFolder
    : path.join(workspaceDir, syncFolder);
  const safeInstanceId = instanceIdentifier.replace(/[:<>"|?*]/g, '_');
  return path.join(resolvedSyncFolder, safeInstanceId, createProjectSlug(projectName));
}

export const n8nManagerPlugin = defineYagrPlugin({
  manifest: {
    name: '@yagr/plugin-n8n-manager',
    version: '0.1.0',
    kind: 'manager',
    description: 'n8n manager integration for Yagr apps.',
    capabilities: {
      workflows: ['n8n-manager'],
      surfaces: ['webui', 'tui'],
      gateways: ['manager'],
    },
  },
});
