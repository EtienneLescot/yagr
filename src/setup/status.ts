import { normalizeGatewaySurfaces, type YagrConfigStoreLike } from '../config/yagr-config-service.js';
import { getGatewaySupervisorStatus } from '../gateway/manager.js';
import type { GatewaySurface } from '../gateway/types.js';
import { isProviderConfigured } from '../llm/provider-registry.js';

export interface YagrSetupStatus {
  ready: boolean;
  llmConfigured: boolean;
  enabledSurfaces: GatewaySurface[];
  startableSurfaces: GatewaySurface[];
  missingSteps: Array<'llm'>;
}

export function buildYagrSetupStatus(input: {
  llmConfigured: boolean;
  enabledSurfaces: GatewaySurface[];
  startableSurfaces: GatewaySurface[];
}): YagrSetupStatus {
  const missingSteps: Array<'llm'> = [];

  if (!input.llmConfigured) {
    missingSteps.push('llm');
  }

  return {
    ready: missingSteps.length === 0,
    llmConfigured: input.llmConfigured,
    enabledSurfaces: input.enabledSurfaces,
    startableSurfaces: input.startableSurfaces,
    missingSteps,
  };
}

export function getYagrSetupStatus(
  yagrConfigService: YagrConfigStoreLike,
  options: { activeSurfaces?: GatewaySurface[] } = {},
): YagrSetupStatus {
  const yagrConfig = yagrConfigService.getLocalConfig();
  const gatewayStatus = getGatewaySupervisorStatus(yagrConfigService);
  const activeSurfaces = normalizeGatewaySurfaces(options.activeSurfaces);

  let llmConfigured = false;
  try {
    llmConfigured = isProviderConfigured(yagrConfig, (provider) => yagrConfigService.getApiKey(provider));
  } catch {
    llmConfigured = false;
  }

  const enabledSurfaces = Array.from(new Set([...gatewayStatus.enabledSurfaces, ...activeSurfaces]));
  const startableSurfaces = Array.from(new Set([...gatewayStatus.startableSurfaces, ...activeSurfaces]));

  return buildYagrSetupStatus({
    llmConfigured,
    enabledSurfaces,
    startableSurfaces,
  });
}
