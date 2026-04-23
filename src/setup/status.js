import { normalizeGatewaySurfaces } from '../config/yagr-config-service.js';
import { getGatewaySupervisorStatus } from '../gateway/manager.js';
import { isProviderConfigured } from '../llm/provider-registry.js';
export function buildYagrSetupStatus(input) {
    const missingSteps = [];
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
export function getYagrSetupStatus(yagrConfigService, n8nConfigService, options = {}) {
    const yagrConfig = yagrConfigService.getLocalConfig();
    const n8nConfig = n8nConfigService.getLocalConfig();
    const gatewayStatus = getGatewaySupervisorStatus(yagrConfigService);
    const activeSurfaces = normalizeGatewaySurfaces(options.activeSurfaces);
    const configuredN8nApiKey = n8nConfig.host
        ? (n8nConfigService.getApiKey(n8nConfig.host)
            ?? (yagrConfig.n8nTunnel?.enabled && yagrConfig.n8nTunnel.targetUrl
                ? n8nConfigService.getApiKey(yagrConfig.n8nTunnel.targetUrl)
                : undefined))
        : undefined;
    const n8nConfigured = Boolean(n8nConfig.host
        && n8nConfig.syncFolder
        && n8nConfig.projectId
        && n8nConfig.projectName
        && configuredN8nApiKey);
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
        n8nConfigured,
        llmConfigured,
        enabledSurfaces,
        startableSurfaces,
    });
}
//# sourceMappingURL=status.js.map