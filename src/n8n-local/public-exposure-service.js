import { YagrConfigService } from '../config/yagr-config-service.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { ensureLocalN8nAuthBridgeRunning, getLocalN8nAuthBridgeBaseUrl } from '../gateway/local-open-bridge.js';
import { buildRelayInfo, ensureN8nRelayServer } from '../llm/llm-relay-server.js';
import { ensureN8nAuthTunnel, ensureN8nTunnel, installCloudflaredIfNeeded, refreshLlmTunnel, refreshN8nTunnel, resolveN8nTunnelTargetUrl, startN8nTunnel, stopN8nAuthTunnel, stopN8nTunnel, } from './n8n-tunnel.js';
import { getConfiguredManagedN8nState } from './managed-runtime.js';
import { readManagedN8nState } from './state.js';
import { startManagedDirectN8n, stopManagedDirectN8n } from './direct-manager.js';
import { startManagedDockerN8n, stopManagedDockerN8n } from './docker-manager.js';
function updateLlmProxyConfig(configService, updater) {
    configService.updateLocalConfig((localConfig) => ({
        ...localConfig,
        llmProxy: localConfig.llmProxy ? updater(localConfig.llmProxy) : localConfig.llmProxy,
    }));
}
export async function restartManagedN8nForTunnel(publicUrl, hooks = {}) {
    const managedState = getConfiguredManagedN8nState();
    if (!managedState || managedState.status === 'stopped') {
        return false;
    }
    hooks.onStart?.(publicUrl);
    try {
        if (managedState.strategy === 'docker') {
            await stopManagedDockerN8n();
            await startManagedDockerN8n();
        }
        else {
            await stopManagedDirectN8n();
            await startManagedDirectN8n();
        }
        hooks.onSuccess?.();
        return true;
    }
    catch (error) {
        hooks.onError?.(error);
        return false;
    }
}
export async function ensureN8nPublicExposure(targetUrl, options = {}) {
    const { action = 'ensure', cloudflaredBin, configService = new YagrConfigService(), restartHooks, } = options;
    const previousPublicUrl = configService.getN8nTunnelConfig()?.publicUrl;
    const bin = cloudflaredBin ?? await installCloudflaredIfNeeded();
    const state = action === 'refresh'
        ? await refreshN8nTunnel(targetUrl, bin)
        : action === 'start'
            ? await startN8nTunnel(targetUrl, bin)
            : await ensureN8nTunnel(targetUrl, bin);
    configService.saveN8nTunnelConfig({ enabled: true, targetUrl, publicUrl: state.publicUrl });
    new YagrN8nConfigService().syncN8nacHostUrl(state.publicUrl);
    const restartedManagedN8n = state.publicUrl !== previousPublicUrl
        ? await restartManagedN8nForTunnel(state.publicUrl, restartHooks)
        : false;
    return {
        state,
        previousPublicUrl,
        restartedManagedN8n,
    };
}
export async function ensureConfiguredN8nPublicExposure(options = {}) {
    const targetUrl = resolveN8nTunnelTargetUrl();
    return ensureN8nPublicExposure(targetUrl, options);
}
export async function ensureN8nAuthPublicExposure(options = {}) {
    await ensureLocalN8nAuthBridgeRunning();
    const targetUrl = getLocalN8nAuthBridgeBaseUrl();
    const bin = options.cloudflaredBin ?? await installCloudflaredIfNeeded();
    const publicUrl = await ensureN8nAuthTunnel(targetUrl, bin);
    return { publicUrl, targetUrl };
}
export async function ensureConfiguredLlmPublicExposure(configService = new YagrConfigService()) {
    const proxyConfig = configService.getLocalConfig().llmProxy;
    if (!proxyConfig?.enabled || proxyConfig.mode !== 'tunnel') {
        return null;
    }
    const relay = await ensureN8nRelayServer();
    return refreshLlmPublicExposureForRelayHostBaseUrl(relay.hostBaseUrl, configService);
}
export async function refreshLlmPublicExposureForRelayHostBaseUrl(hostBaseUrl, configService = new YagrConfigService(), cloudflaredBin) {
    const bin = cloudflaredBin ?? await installCloudflaredIfNeeded();
    const tunnelUrl = await refreshLlmTunnel(hostBaseUrl, bin);
    updateLlmProxyConfig(configService, (current) => ({
        ...current,
        llmTunnelUrl: tunnelUrl,
        credentialBaseUrl: `${tunnelUrl}/v1`,
    }));
    return tunnelUrl;
}
export async function stopN8nPublicExposureSet(configService = new YagrConfigService()) {
    await stopN8nTunnel();
    await stopN8nAuthTunnel();
    configService.clearN8nTunnelConfig();
    const managedState = readManagedN8nState();
    const localHost = `http://127.0.0.1:${managedState?.port ?? 5678}`;
    new YagrN8nConfigService().syncN8nacHostUrl(localHost);
}
export async function getConfiguredLlmRelayInfoWithExposure(configService = new YagrConfigService()) {
    if (configService.getLocalConfig().llmProxy?.mode === 'tunnel') {
        await ensureConfiguredLlmPublicExposure(configService);
    }
    const relay = await ensureN8nRelayServer();
    return buildRelayInfo(relay.port);
}
//# sourceMappingURL=public-exposure-service.js.map