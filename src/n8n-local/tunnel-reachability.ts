import { YagrConfigService, type YagrConfigStoreLike, type YagrLocalConfig, type YagrTunnelReachabilityMode } from '../config/yagr-config-service.js';
import { ensureN8nRelayServer } from '../llm/llm-relay-server.js';
import {
  resolveN8nTunnelTargetUrl,
} from './n8n-tunnel.js';
import {
  ensureConfiguredLlmPublicExposure,
  ensureN8nAuthPublicExposure,
  ensureN8nPublicExposure,
  refreshLlmPublicExposureForRelayHostBaseUrl,
} from './public-exposure-service.js';

export type TunnelReachabilityConsumer = 'telegram' | 'webui' | 'tui' | 'cli' | 'setup' | 'llm';
const YAGR_TUNNEL_REACHABILITY_MODE_ENV = 'YAGR_TUNNEL_REACHABILITY_MODE';

function resolveTunnelReachabilityMode(configService: YagrConfigStoreLike = new YagrConfigService()): YagrTunnelReachabilityMode {
  const envMode = process.env[YAGR_TUNNEL_REACHABILITY_MODE_ENV]?.trim();
  if (envMode === 'force-all-facades' || envMode === 'on-demand') {
    return envMode;
  }
  return configService.getLocalConfig().tunnels?.reachabilityMode ?? 'force-all-facades';
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

  await ensureN8nPublicExposure(targetUrl, { action: 'ensure', configService });
}

export async function ensureN8nAuthTunnelReachability(
  consumer: TunnelReachabilityConsumer,
  configService: YagrConfigStoreLike = new YagrConfigService(),
): Promise<void> {
  if (!shouldWakeFacadeTunnel(consumer, configService)) {
    return;
  }

  await ensureN8nAuthPublicExposure();
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
  await ensureConfiguredLlmPublicExposure(configService);
}

export async function ensureLlmTunnelForRelayHostBaseUrl(
  hostBaseUrl: string,
  configService: YagrConfigStoreLike = new YagrConfigService(),
): Promise<string> {
  return refreshLlmPublicExposureForRelayHostBaseUrl(hostBaseUrl, configService);
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
      const newUrl = await refreshLlmPublicExposureForRelayHostBaseUrl(relay.hostBaseUrl, configService);
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
      const { state } = await ensureN8nPublicExposure(targetUrl, { action: 'refresh', configService });
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
