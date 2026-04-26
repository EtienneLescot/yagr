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

export interface YagrLlmLocalConfigShape {
  provider?: string;
  model?: string;
  baseUrl?: string;
  llmProxy?: {
    enabled?: boolean;
    credentialBaseUrl?: string;
  };
}

export interface YagrLlmConfigReader {
  getLocalConfig(): YagrLlmLocalConfigShape;
  getApiKey?(provider: string): string | undefined;
}

export interface N8nManagerSecretRef {
  provider: string;
  key: string;
}

export interface N8nManagerLlmConnectionDescriptor {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKeyRef?: N8nManagerSecretRef;
  openAiCompatible: boolean;
  proxyBaseUrl?: string;
}

export interface N8nManagerLlmSource {
  id: string;
  label: string;
  getDescriptor(): Promise<N8nManagerLlmConnectionDescriptor>;
  getSecret?(ref: N8nManagerSecretRef): Promise<string | undefined>;
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

export function createYagrLlmSource(configReader: YagrLlmConfigReader): N8nManagerLlmSource {
  return {
    id: 'yagr-default-llm',
    label: 'YAGR configured LLM',
    async getDescriptor() {
      const config = configReader.getLocalConfig();
      const provider = config.provider ?? 'openai-compatible';
      return {
        provider,
        model: config.model ?? 'default',
        baseUrl: config.baseUrl,
        apiKeyRef: { provider, key: 'apiKey' },
        openAiCompatible: isOpenAiCompatibleProvider(provider),
        proxyBaseUrl: config.llmProxy?.enabled ? config.llmProxy.credentialBaseUrl : undefined,
      };
    },
    async getSecret(ref) {
      return configReader.getApiKey?.(ref.provider);
    },
  };
}

function isOpenAiCompatibleProvider(provider: string): boolean {
  return [
    'openai',
    'google',
    'mistral',
    'openrouter',
    'openai-oauth',
    'copilot-proxy',
    'openai-compatible',
  ].includes(provider);
}

export const n8nManagerPlugin = defineYagrPlugin({
  manifest: {
    name: '@yagr/plugin-n8n-manager',
    version: '0.1.0',
    kind: 'manager',
    description: 'Optional n8n-manager integration adapters for Yagr apps.',
    capabilities: {
      tools: ['n8n-manager-cli'],
      workflows: ['n8n-manager', 'n8n-credentials-manager'],
      surfaces: ['webui', 'tui'],
      gateways: ['manager'],
      providers: ['yagr-llm-source'],
    },
  },
});
