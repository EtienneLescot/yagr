import { normalizeGatewaySurfaces, type YagrConfigService } from '../config/yagr-config-service.js';
import type { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { getGatewaySupervisorStatus } from '../gateway/manager.js';
import type { GatewaySurface } from '../gateway/types.js';
import { isProviderConfigured } from '../llm/provider-registry.js';

export interface YagrSetupStatus {
  ready: boolean;
  n8nConfigured: boolean;
  llmConfigured: boolean;
  enabledSurfaces: GatewaySurface[];
  startableSurfaces: GatewaySurface[];
  missingSteps: Array<'n8n' | 'llm'>;
}

export function buildYagrSetupStatus(input: {
  n8nConfigured: boolean;
  llmConfigured: boolean;
  enabledSurfaces: GatewaySurface[];
  startableSurfaces: GatewaySurface[];
}): YagrSetupStatus {
  const missingSteps: Array<'n8n' | 'llm'> = [];

  if (!input.n8nConfigured) {
    missingSteps.push('n8n');
  }

  if (!input.llmConfigured) {
    missingSteps.push('llm');
  }

  return {
    ready: missingSteps.length === 0,
    n8nConfigured: input.n8nConfigured,
    llmConfigured: input.llmConfigured,
    enabledSurfaces: input.enabledSurfaces,
    startableSurfaces: input.startableSurfaces,
    missingSteps,
  };
}

export function getYagrSetupStatus(
  yagrConfigService: Pick<YagrConfigService, 'getLocalConfig' | 'getApiKey'>,
  n8nConfigService: Pick<YagrN8nConfigService, 'getLocalConfig' | 'getApiKey'>,
  options: { activeSurfaces?: GatewaySurface[] } = {},
): YagrSetupStatus {
  const yagrConfig = yagrConfigService.getLocalConfig();
  const n8nConfig = n8nConfigService.getLocalConfig();
  const gatewayStatus = getGatewaySupervisorStatus(yagrConfigService as YagrConfigService);
  const activeSurfaces = normalizeGatewaySurfaces(options.activeSurfaces);

  const n8nConfigured = Boolean(
    n8nConfig.host
    && n8nConfig.syncFolder
    && n8nConfig.projectId
    && n8nConfig.projectName
    && n8nConfigService.getApiKey(n8nConfig.host),
  );

  let llmConfigured = false;
  try {
    llmConfigured = isProviderConfigured(yagrConfig, (provider) => yagrConfigService.getApiKey(provider));
  } catch {
    llmConfigured = false;
  }

  const enabledSurfaces = Array.from(new Set([...gatewayStatus.enabledSurfaces, ...activeSurfaces]));
  const startableSurfaces = Array.from(new Set([...gatewayStatus.startableSurfaces, ...activeSurfaces]));

  return buildYagrSetupStatus({
    n8nConfigured,
    llmConfigured,
    enabledSurfaces,
    startableSurfaces,
  });
}
