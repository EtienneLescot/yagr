import { N8nApiClient } from 'n8nac';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import {
  getManagedDirectN8nStatus,
  startManagedDirectN8n,
} from './direct-manager.js';
import {
  getManagedDockerN8nStatus,
  startManagedDockerN8n,
} from './docker-manager.js';
import { readManagedN8nState, type ManagedN8nInstanceState } from './state.js';

function normalizeUrlOrigin(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/$/, '');
  }
}

export function getConfiguredManagedN8nState(
  configService = new YagrN8nConfigService(),
): ManagedN8nInstanceState | undefined {
  const localConfig = configService.getLocalConfig();
  if (localConfig.runtimeSource !== 'managed-local') {
    return undefined;
  }

  const configuredHost = normalizeUrlOrigin(localConfig.host);
  const managedState = readManagedN8nState();
  if (!configuredHost || !managedState) {
    return undefined;
  }

  return normalizeUrlOrigin(managedState.url) === configuredHost
    ? managedState
    : undefined;
}

export async function ensureConfiguredManagedN8nRunning(
  configService = new YagrN8nConfigService(),
): Promise<{ state?: ManagedN8nInstanceState; started: boolean }> {
  const managedState = getConfiguredManagedN8nState(configService);
  if (!managedState) {
    return { started: false };
  }

  if (managedState.strategy === 'direct') {
    const status = await getManagedDirectN8nStatus();
    if (status.running && status.healthy && status.state) {
      return { state: status.state, started: false };
    }

    return { state: await startManagedDirectN8n(), started: true };
  }

  const status = await getManagedDockerN8nStatus();
  if (status.running && status.healthy && status.state) {
    return { state: status.state, started: false };
  }

  return { state: await startManagedDockerN8n(), started: true };
}

export async function getConfiguredExternalN8nReachabilityWarning(
  configService = new YagrN8nConfigService(),
): Promise<string | undefined> {
  const localConfig = configService.getLocalConfig();
  if (localConfig.runtimeSource === 'managed-local') {
    return undefined;
  }

  if (!localConfig.host) {
    return undefined;
  }

  const apiKey = configService.getApiKey(localConfig.host);
  if (!apiKey) {
    return undefined;
  }

  try {
    const client = new N8nApiClient({ host: localConfig.host, apiKey });
    const connected = await client.testConnection();
    if (connected) {
      return undefined;
    }
  } catch {
    // Fall through to the same warning message.
  }

  return `Configured external n8n instance is not reachable at ${localConfig.host}. Yagr will not restart manually-managed instances automatically.`;
}
