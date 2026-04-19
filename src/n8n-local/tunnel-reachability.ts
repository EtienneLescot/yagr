import { YagrConfigService, type YagrConfigStoreLike, type YagrLocalConfig, type YagrLlmProxyConfig, type YagrTunnelReachabilityMode } from '../config/yagr-config-service.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { ensureLocalN8nAuthBridgeRunning, getLocalN8nAuthBridgeBaseUrl } from '../gateway/local-open-bridge.js';
import { ensureN8nRelayServer } from '../llm/llm-relay-server.js';
import {
  ensureN8nTunnel,
  ensureN8nAuthTunnel,
  installCloudflaredIfNeeded,
  resolveN8nTunnelTargetUrl,
  refreshLlmTunnel,
  refreshN8nTunnel,
} from './n8n-tunnel.js';
import { getConfiguredManagedN8nState } from './managed-runtime.js';
import { startManagedDirectN8n, stopManagedDirectN8n } from './direct-manager.js';
import { startManagedDockerN8n, stopManagedDockerN8n } from './docker-manager.js';

export type TunnelReachabilityConsumer = 'telegram' | 'webui' | 'tui' | 'cli' | 'setup' | 'llm';
const YAGR_TUNNEL_REACHABILITY_MODE_ENV = 'YAGR_TUNNEL_REACHABILITY_MODE';

function resolveTunnelReachabilityMode(configService: YagrConfigStoreLike = new YagrConfigService()): YagrTunnelReachabilityMode {
  const envMode = process.env[YAGR_TUNNEL_REACHABILITY_MODE_ENV]?.trim();
  if (envMode === 'force-all-facades' || envMode === 'on-demand') {
    return envMode;
  }
  return configService.getLocalConfig().tunnels?.reachabilityMode ?? 'on-demand';
}

function shouldForceAllFacades(configService: YagrConfigStoreLike = new YagrConfigService()): boolean {
  return resolveTunnelReachabilityMode(configService) === 'force-all-facades';
}

function shouldWakeFacadeTunnel(consumer: TunnelReachabilityConsumer, configService: YagrConfigStoreLike = new YagrConfigService()): boolean {
  return consumer === 'telegram' || shouldForceAllFacades(configService);
}

async function checkLocalServiceHealth(serviceUrl: string): Promise<boolean> {
  try {
    const response = await fetch(serviceUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function probePublicUrl(publicUrl: string): Promise<boolean> {
  try {
    const response = await fetch(publicUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function restartManagedN8nForTunnel(publicUrl: string): Promise<void> {
  const managedState = getConfiguredManagedN8nState();
  if (!managedState || managedState.status === 'stopped') return;

  new YagrN8nConfigService().syncN8nacHostUrl(publicUrl);

  if (managedState.strategy === 'docker') {
    await stopManagedDockerN8n();
    await startManagedDockerN8n();
    return;
  }

  await stopManagedDirectN8n();
  await startManagedDirectN8n();
}

function updateLlmProxyConfig(configService: YagrConfigStoreLike, updater: (cfg: YagrLlmProxyConfig) => YagrLlmProxyConfig): void {
  configService.updateLocalConfig((localConfig) => ({
    ...localConfig,
    llmProxy: localConfig.llmProxy ? updater(localConfig.llmProxy) : localConfig.llmProxy,
  }));
}

export async function ensureConfiguredN8nTunnelReachability(
  consumer: TunnelReachabilityConsumer,
  configService: YagrConfigService = new YagrConfigService(),
): Promise<void> {
  const tunnelConfig = configService.getN8nTunnelConfig();
  if (!tunnelConfig?.enabled || !shouldWakeFacadeTunnel(consumer, configService)) {
    return;
  }

  const targetUrl = resolveN8nTunnelTargetUrl();
  if (!(await checkLocalServiceHealth(targetUrl))) {
    return;
  }

  const previousPublicUrl = tunnelConfig.publicUrl;
  const bin = await installCloudflaredIfNeeded();
  const state = await ensureN8nTunnel(targetUrl, bin);
  configService.saveN8nTunnelConfig({ ...tunnelConfig, targetUrl, publicUrl: state.publicUrl });
  new YagrN8nConfigService().syncN8nacHostUrl(state.publicUrl);

  if (state.publicUrl !== previousPublicUrl) {
    await restartManagedN8nForTunnel(state.publicUrl);
  }
}

export async function ensureN8nAuthTunnelReachability(
  consumer: TunnelReachabilityConsumer,
  configService: YagrConfigStoreLike = new YagrConfigService(),
): Promise<void> {
  if (!shouldWakeFacadeTunnel(consumer, configService)) {
    return;
  }

  await ensureLocalN8nAuthBridgeRunning();
  const bridgeUrl = getLocalN8nAuthBridgeBaseUrl();
  const bin = await installCloudflaredIfNeeded();
  await ensureN8nAuthTunnel(bridgeUrl, bin);
}

export async function ensureFacadeTunnelReachability(
  consumer: TunnelReachabilityConsumer,
  configService: YagrConfigService = new YagrConfigService(),
): Promise<void> {
  await ensureConfiguredN8nTunnelReachability(consumer, configService);
  await ensureN8nAuthTunnelReachability(consumer, configService);
}

export async function ensureConfiguredLlmTunnelReachability(
  configService: YagrConfigStoreLike = new YagrConfigService(),
): Promise<void> {
  const proxyConfig = configService.getLocalConfig().llmProxy;
  if (!proxyConfig?.enabled || proxyConfig.mode !== 'tunnel') {
    return;
  }

  const relay = await ensureN8nRelayServer();
  await ensureLlmTunnelForRelayHostBaseUrl(relay.hostBaseUrl, configService);
}

export async function ensureLlmTunnelForRelayHostBaseUrl(
  hostBaseUrl: string,
  configService: YagrConfigStoreLike = new YagrConfigService(),
): Promise<string> {
  const bin = await installCloudflaredIfNeeded();
  const tunnelUrl = await refreshLlmTunnel(hostBaseUrl, bin);
  updateLlmProxyConfig(configService, (current) => ({
    ...current,
    llmTunnelUrl: tunnelUrl,
    credentialBaseUrl: `${tunnelUrl}/v1`,
  }));
  return tunnelUrl;
}

export function getTunnelReachabilityDebugSnapshot(configService: YagrConfigStoreLike = new YagrConfigService()): {
  reachabilityMode: YagrTunnelReachabilityMode;
  forceAllFacades: boolean;
  localConfig: YagrLocalConfig;
} {
  return {
    reachabilityMode: resolveTunnelReachabilityMode(configService),
    forceAllFacades: shouldForceAllFacades(configService),
    localConfig: configService.getLocalConfig(),
  };
}

export interface StartupTunnelPreflightResult {
  llmTunnel: {
    refreshed: boolean;
    publicUrl: string | null;
    skipped: boolean;
    reason?: string;
  };
  n8nTunnel: {
    refreshed: boolean;
    publicUrl: string | null;
    skipped: boolean;
    reason?: string;
  };
}

async function refreshLlmTunnelIfStale(
  configService: YagrConfigService,
): Promise<StartupTunnelPreflightResult['llmTunnel']> {
  const proxyConfig = configService.getLocalConfig().llmProxy;
  if (!proxyConfig?.enabled || proxyConfig.mode !== 'tunnel') {
    return { refreshed: false, publicUrl: null, skipped: true, reason: 'not configured or not in tunnel mode' };
  }

  const relay = await ensureN8nRelayServer();
  const storedUrl = proxyConfig.llmTunnelUrl;

  if (storedUrl && !(await probePublicUrl(storedUrl))) {
    try {
      const bin = await installCloudflaredIfNeeded();
      const newUrl = await refreshLlmTunnel(relay.hostBaseUrl, bin);
      configService.updateLocalConfig((localConfig) => ({
        ...localConfig,
        llmProxy: localConfig.llmProxy
          ? { ...localConfig.llmProxy, llmTunnelUrl: newUrl, credentialBaseUrl: `${newUrl}/v1` }
          : localConfig.llmProxy,
      }));
      return { refreshed: true, publicUrl: newUrl, skipped: false };
    } catch {
      return { refreshed: false, publicUrl: storedUrl, skipped: false, reason: 'refresh failed, keeping stale URL' };
    }
  }

  return { refreshed: false, publicUrl: storedUrl ?? null, skipped: true, reason: storedUrl ? 'URL still reachable' : 'no stored URL' };
}

async function refreshN8nTunnelIfStale(
  configService: YagrConfigService,
): Promise<StartupTunnelPreflightResult['n8nTunnel']> {
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
      const bin = await installCloudflaredIfNeeded();
      const state = await refreshN8nTunnel(targetUrl, bin);
      configService.saveN8nTunnelConfig({ ...tunnelConfig, targetUrl, publicUrl: state.publicUrl });
      new YagrN8nConfigService().syncN8nacHostUrl(state.publicUrl);
      await restartManagedN8nForTunnel(state.publicUrl);
      return { refreshed: true, publicUrl: state.publicUrl, skipped: false };
    } catch {
      return { refreshed: false, publicUrl: storedUrl, skipped: false, reason: 'refresh failed, keeping stale URL' };
    }
  }

  return { refreshed: false, publicUrl: storedUrl ?? null, skipped: true, reason: storedUrl ? 'URL still reachable' : 'no stored URL' };
}

export async function ensureStartupTunnelReachability(
  configService: YagrConfigService = new YagrConfigService(),
): Promise<StartupTunnelPreflightResult> {
  const [llmTunnel, n8nTunnel] = await Promise.all([
    refreshLlmTunnelIfStale(configService),
    refreshN8nTunnelIfStale(configService),
  ]);
  return { llmTunnel, n8nTunnel };
}
