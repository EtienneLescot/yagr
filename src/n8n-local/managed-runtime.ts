import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import {
  getManagedDirectN8nStatus,
  startManagedDirectN8n,
} from './direct-manager.js';
import {
  getManagedDockerN8nStatus,
  startManagedDockerN8n,
} from './docker-manager.js';
import type { ManagedN8nInstanceState } from './state.js';
import { classifyConfiguredN8nInstance } from './instance-classification.js';

export type ConfiguredN8nRuntimeMode =
  | 'unconfigured'
  | 'yagr-managed-local'
  | 'local'
  | 'cloud';

export interface ConfiguredN8nLaunchPreparation {
  mode: ConfiguredN8nRuntimeMode;
  started: boolean;
  state?: ManagedN8nInstanceState;
  warning?: string;
}

function resolveConfiguredRuntimeMode(configService: YagrN8nConfigService): {
  source: ConfiguredN8nRuntimeMode;
  localConfig: ReturnType<YagrN8nConfigService['getLocalConfig']>;
  managedState: ManagedN8nInstanceState | undefined;
} {
  const localConfig = configService.getLocalConfig();
  const classification = classifyConfiguredN8nInstance(configService);

  if (!localConfig.host) {
    return {
      source: 'unconfigured',
      localConfig,
      managedState: classification.managedState,
    };
  }

  return {
    source: classification.kind === 'yagr-managed-local'
      ? 'yagr-managed-local'
      : classification.kind === 'local'
        ? 'local'
        : 'cloud',
    localConfig,
    managedState: classification.managedState,
  };
}

export function getConfiguredManagedN8nState(
  configService = new YagrN8nConfigService(),
): ManagedN8nInstanceState | undefined {
  return resolveConfiguredRuntimeMode(configService).managedState;
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
  const { source, localConfig } = resolveConfiguredRuntimeMode(configService);
  if (source !== 'local' && source !== 'cloud') {
    return undefined;
  }

  if (!localConfig.host) {
    return undefined;
  }

  try {
    const response = await fetch(new URL('/healthz', localConfig.host), {
      method: 'GET',
    });
    if (response.ok) {
      return undefined;
    }
  } catch {
    // Fall through to the same warning message.
  }

  return `Configured external n8n instance is not reachable at ${localConfig.host}. Yagr will not restart manually-managed instances automatically.`;
}

export async function prepareConfiguredN8nForLaunch(
  configService = new YagrN8nConfigService(),
): Promise<ConfiguredN8nLaunchPreparation> {
  const { source } = resolveConfiguredRuntimeMode(configService);

  if (source === 'yagr-managed-local') {
    const ensured = await ensureConfiguredManagedN8nRunning(configService);
    return {
      mode: source,
      started: ensured.started,
      state: ensured.state,
    };
  }

  if (source === 'local' || source === 'cloud') {
    return {
      mode: source,
      started: false,
      warning: await getConfiguredExternalN8nReachabilityWarning(configService),
    };
  }

  return {
    mode: source,
    started: false,
  };
}
