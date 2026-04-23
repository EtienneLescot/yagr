import { YagrConfigService } from '../config/yagr-config-service.js';
import { ensureN8nRelayServer } from '../llm/llm-relay-server.js';
import { resolveN8nTunnelTargetUrl, } from './n8n-tunnel.js';
import { ensureConfiguredLlmPublicExposure, ensureN8nAuthPublicExposure, ensureN8nPublicExposure, refreshLlmPublicExposureForRelayHostBaseUrl, } from './public-exposure-service.js';
const YAGR_TUNNEL_REACHABILITY_MODE_ENV = 'YAGR_TUNNEL_REACHABILITY_MODE';
function resolveTunnelReachabilityMode(configService = new YagrConfigService()) {
    const envMode = process.env[YAGR_TUNNEL_REACHABILITY_MODE_ENV]?.trim();
    if (envMode === 'force-all-facades' || envMode === 'on-demand') {
        return envMode;
    }
    return configService.getLocalConfig().tunnels?.reachabilityMode ?? 'force-all-facades';
}
function shouldForceAllFacades(configService = new YagrConfigService()) {
    return resolveTunnelReachabilityMode(configService) === 'force-all-facades';
}
function shouldWakeFacadeTunnel(consumer, configService = new YagrConfigService()) {
    return consumer === 'telegram' || shouldForceAllFacades(configService);
}
async function checkLocalServiceHealth(serviceUrl) {
    try {
        const response = await fetch(serviceUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
        });
        return response.ok;
    }
    catch {
        return false;
    }
}
async function probePublicUrl(publicUrl) {
    try {
        const response = await fetch(publicUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(8000),
        });
        return response.ok || response.status < 500;
    }
    catch {
        return false;
    }
}
export async function ensureConfiguredN8nTunnelReachability(consumer, configService = new YagrConfigService()) {
    const tunnelConfig = configService.getN8nTunnelConfig();
    if (!tunnelConfig?.enabled || !shouldWakeFacadeTunnel(consumer, configService)) {
        return;
    }
    const targetUrl = resolveN8nTunnelTargetUrl();
    if (!(await checkLocalServiceHealth(targetUrl))) {
        return;
    }
    await ensureN8nPublicExposure(targetUrl, { action: 'ensure', configService });
}
export async function ensureN8nAuthTunnelReachability(consumer, configService = new YagrConfigService()) {
    if (!shouldWakeFacadeTunnel(consumer, configService)) {
        return;
    }
    await ensureN8nAuthPublicExposure();
}
export async function ensureFacadeTunnelReachability(consumer, configService = new YagrConfigService()) {
    await ensureConfiguredN8nTunnelReachability(consumer, configService);
    await ensureN8nAuthTunnelReachability(consumer, configService);
}
export async function ensureConfiguredLlmTunnelReachability(configService = new YagrConfigService()) {
    await ensureConfiguredLlmPublicExposure(configService);
}
export async function ensureLlmTunnelForRelayHostBaseUrl(hostBaseUrl, configService = new YagrConfigService()) {
    return refreshLlmPublicExposureForRelayHostBaseUrl(hostBaseUrl, configService);
}
export function getTunnelReachabilityDebugSnapshot(configService = new YagrConfigService()) {
    return {
        reachabilityMode: resolveTunnelReachabilityMode(configService),
        forceAllFacades: shouldForceAllFacades(configService),
        localConfig: configService.getLocalConfig(),
    };
}
async function refreshLlmTunnelIfStale(configService) {
    const proxyConfig = configService.getLocalConfig().llmProxy;
    if (!proxyConfig?.enabled || proxyConfig.mode !== 'tunnel') {
        return { refreshed: false, publicUrl: null, skipped: true, reason: 'not configured or not in tunnel mode' };
    }
    const relay = await ensureN8nRelayServer();
    const storedUrl = proxyConfig.llmTunnelUrl;
    if (storedUrl && !(await probePublicUrl(storedUrl))) {
        try {
            const newUrl = await refreshLlmPublicExposureForRelayHostBaseUrl(relay.hostBaseUrl, configService);
            return { refreshed: true, publicUrl: newUrl, skipped: false };
        }
        catch {
            return { refreshed: false, publicUrl: storedUrl, skipped: false, reason: 'refresh failed, keeping stale URL' };
        }
    }
    return { refreshed: false, publicUrl: storedUrl ?? null, skipped: true, reason: storedUrl ? 'URL still reachable' : 'no stored URL' };
}
async function refreshN8nTunnelIfStale(configService) {
    const tunnelConfig = configService.getN8nTunnelConfig();
    if (!tunnelConfig?.enabled) {
        return { refreshed: false, publicUrl: null, skipped: true, reason: 'not enabled' };
    }
    const targetUrl = resolveN8nTunnelTargetUrl();
    if (!(await checkLocalServiceHealth(targetUrl))) {
        return { refreshed: false, publicUrl: tunnelConfig.publicUrl ?? null, skipped: true, reason: 'local n8n target not reachable' };
    }
    const storedUrl = tunnelConfig.publicUrl;
    if (storedUrl && !(await probePublicUrl(storedUrl))) {
        try {
            const { state } = await ensureN8nPublicExposure(targetUrl, { action: 'refresh', configService });
            return { refreshed: true, publicUrl: state.publicUrl, skipped: false };
        }
        catch {
            return { refreshed: false, publicUrl: storedUrl, skipped: false, reason: 'refresh failed, keeping stale URL' };
        }
    }
    return { refreshed: false, publicUrl: storedUrl ?? null, skipped: true, reason: storedUrl ? 'URL still reachable' : 'no stored URL' };
}
export async function ensureStartupTunnelReachability(configService = new YagrConfigService()) {
    const [llmTunnel, n8nTunnel] = await Promise.all([
        refreshLlmTunnelIfStale(configService),
        refreshN8nTunnelIfStale(configService),
    ]);
    return { llmTunnel, n8nTunnel };
}
//# sourceMappingURL=tunnel-reachability.js.map