import { YagrConfigService, type YagrConfigStoreLike, type YagrLocalConfig, type YagrLlmProxyConfig, type YagrTunnelReachabilityMode } from '../config/yagr-config-service.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { ensureLocalN8nAuthBridgeRunning, getLocalN8nAuthBridgeBaseUrl } from '../gateway/local-open-bridge.js';
import { ensureN8nRelayServer } from '../llm/llm-relay-server.js';
import {
  ensureN8nTunnel,
  ensureN8nAuthTunnel,
  installCloudflaredIfNeeded,
  resolveN8nTunnelTargetUrl,
  startLlmTunnel,
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
  const tunnelUrl = await startLlmTunnel(hostBaseUrl, bin);
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
