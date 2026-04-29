import { normalizeGatewaySurfaces } from '../config/yagr-config-service.js';
import { getGatewaySupervisorStatus } from '../gateway/manager.js';
import { isProviderConfigured } from '../llm/provider-registry.js';
export function buildYagrSetupStatus(input) {
    const missingSteps = [];
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
export function getYagrSetupStatus(yagrConfigService, options = {}) {
    const yagrConfig = yagrConfigService.getLocalConfig();
    const gatewayStatus = getGatewaySupervisorStatus(yagrConfigService);
    const activeSurfaces = normalizeGatewaySurfaces(options.activeSurfaces);
    let llmConfigured = false;
    try {
        llmConfigured = isProviderConfigured(yagrConfig, (provider) => yagrConfigService.getApiKey(provider));
    }
    catch {
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
//# sourceMappingURL=status.js.map