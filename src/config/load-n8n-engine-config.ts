import type { N8nEngineConfig } from '../types.js';
import { N8nEngine } from '../engine/n8n-engine.js';
import { YagrN8nConfigService } from './n8n-config-service.js';

function missingFieldError(field: string): Error {
  return new Error(
    `Missing required n8n workspace configuration field: ${field}. Initialize the workspace before starting Yagr.`,
  );
}

export async function loadN8nEngineConfig(configService = new YagrN8nConfigService()): Promise<N8nEngineConfig> {
  const localConfig = configService.getLocalConfig();

  if (!localConfig.host) {
    throw missingFieldError('host');
  }
  if (!localConfig.syncFolder) {
    throw missingFieldError('syncFolder');
  }
  if (!localConfig.projectId) {
    throw missingFieldError('projectId');
  }
  if (!localConfig.projectName) {
    throw missingFieldError('projectName');
  }

  const apiKey = configService.getApiKey(localConfig.host);
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${localConfig.host}. Authenticate with n8n-as-code before starting Yagr.`,
    );
  }

  const instanceIdentifier =
    localConfig.instanceIdentifier ??
    (await configService.getOrCreateInstanceIdentifier(localConfig.host));

  return {
    host: localConfig.host,
    apiKey,
    syncFolder: localConfig.syncFolder,
    projectId: localConfig.projectId,
    projectName: localConfig.projectName,
    instanceIdentifier,
  };
}

export async function createN8nEngineFromWorkspace(
  configService = new YagrN8nConfigService(),
): Promise<N8nEngine> {
  const config = await loadN8nEngineConfig(configService);
  return new N8nEngine(config);
}
