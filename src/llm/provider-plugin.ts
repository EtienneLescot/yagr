import { fetchGitHubCopilotModels } from './copilot-account.js';
import { primeProviderModelMetadata, warmProviderMetadataCacheFromDiscovery } from './provider-metadata.js';
import {
  getDefaultBaseUrlForProvider,
  getProviderDefinition,
  isOAuthAccountProvider,
  type YagrModelProvider,
  type YagrProviderDefinition,
} from './provider-registry.js';

export interface YagrProviderTransportContract {
  usesOpenAiCompatibleApi: boolean;
  managedProxy: boolean;
  oauthAccount: boolean;
}

export interface YagrProviderMetadataContract {
  warmDiscoveryPayload?: (payload: Record<string, unknown>) => void;
  primeModelMetadata?: (args: { model: string; apiKey?: string; baseUrl?: string }) => Promise<void>;
}

export interface YagrProviderDiscoveryContract {
  fetchAvailableModels?: (args: { apiKey?: string; baseUrl?: string }) => Promise<string[]>;
}

export interface YagrProviderPlugin {
  id: YagrModelProvider;
  definition: YagrProviderDefinition;
  transport: YagrProviderTransportContract;
  discovery?: YagrProviderDiscoveryContract;
  metadata?: YagrProviderMetadataContract;
}

function buildProviderPlugin(provider: YagrModelProvider): YagrProviderPlugin {
  const definition = getProviderDefinition(provider);

  const plugin: YagrProviderPlugin = {
    id: provider,
    definition,
    transport: {
      usesOpenAiCompatibleApi: definition.usesOpenAiCompatibleApi,
      managedProxy: Boolean(definition.managedProxy),
      oauthAccount: isOAuthAccountProvider(provider),
    },
  };

  const discovery = buildProviderDiscovery(provider, definition);
  if (discovery) {
    plugin.discovery = discovery;
  }

  if (provider === 'openrouter') {
    plugin.metadata = {
      warmDiscoveryPayload: (payload) => {
        warmProviderMetadataCacheFromDiscovery(provider, payload);
      },
      primeModelMetadata: async ({ model, apiKey, baseUrl }) => {
        await primeProviderModelMetadata(provider, model, apiKey, baseUrl);
      },
    };
  } else if (provider === 'copilot-proxy') {
    plugin.metadata = {
      warmDiscoveryPayload: (payload) => {
        warmProviderMetadataCacheFromDiscovery(provider, payload);
      },
      primeModelMetadata: async ({ model, apiKey, baseUrl }) => {
        await primeProviderModelMetadata(provider, model, apiKey, baseUrl).catch(() => undefined);
      },
    };
  } else if (provider === 'anthropic' || provider === 'google') {
    plugin.metadata = {
      primeModelMetadata: async ({ model, apiKey, baseUrl }) => {
        await primeProviderModelMetadata(provider, model, apiKey, baseUrl).catch(() => undefined);
      },
    };
  } else if (provider === 'mistral') {
    plugin.metadata = {
      warmDiscoveryPayload: (payload) => {
        warmProviderMetadataCacheFromDiscovery(provider, payload);
      },
      primeModelMetadata: async ({ model, apiKey, baseUrl }) => {
        await primeProviderModelMetadata(provider, model, apiKey, baseUrl).catch(() => undefined);
      },
    };
  } else if (definition.modelDiscovery) {
    plugin.metadata = {
      warmDiscoveryPayload: (payload) => {
        warmProviderMetadataCacheFromDiscovery(provider, payload);
      },
    };
  }

  return plugin;
}

function buildProviderDiscovery(
  provider: YagrModelProvider,
  definition: YagrProviderDefinition,
): YagrProviderDiscoveryContract | undefined {
  const discovery = definition.modelDiscovery;
  if (provider === 'copilot-proxy') {
    return {
      fetchAvailableModels: async ({ apiKey, baseUrl }) => {
        if (!apiKey) {
          return [];
        }

        const response = await fetch(`${baseUrl || getDefaultBaseUrlForProvider(provider)}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
            'User-Agent': 'GitHubCopilotChat/0.26.7',
            'Editor-Version': 'vscode/1.96.2',
            'Editor-Plugin-Version': 'copilot-chat/0.26.7',
          },
        });
        if (!response.ok) {
          return [];
        }

        const payload = await response.json() as Record<string, unknown>;
        getProviderPlugin(provider).metadata?.warmDiscoveryPayload?.(payload);
        return fetchGitHubCopilotModels(apiKey, baseUrl || getDefaultBaseUrlForProvider(provider));
      },
    };
  }

  if (!discovery) {
    return undefined;
  }

  return {
    fetchAvailableModels: async ({ apiKey, baseUrl }) => {
      const discoveryUrl = discovery.buildUrl(baseUrl || getDefaultBaseUrlForProvider(provider));
      if (!discoveryUrl) {
        return [];
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if ((discovery.authMode === 'bearer-optional' || discovery.authMode === 'bearer-required') && apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      if (discovery.authMode === 'x-api-key-required' && apiKey) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      }

      if (discovery.authMode === 'bearer-required' && !apiKey) {
        return [];
      }

      if (discovery.authMode === 'x-api-key-required' && !apiKey) {
        return [];
      }

      try {
        const response = await fetch(discoveryUrl, { headers });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const payload = await response.json() as Record<string, unknown>;
        getProviderPlugin(provider).metadata?.warmDiscoveryPayload?.(payload);
        return discovery.mapResponse(payload).sort((left, right) => left.localeCompare(right));
      } catch {
        return [];
      }
    },
  };
}

const providerPluginCache = new Map<YagrModelProvider, YagrProviderPlugin>();

export function getProviderPlugin(provider: YagrModelProvider): YagrProviderPlugin {
  const cached = providerPluginCache.get(provider);
  if (cached) {
    return cached;
  }

  const plugin = buildProviderPlugin(provider);
  providerPluginCache.set(provider, plugin);
  return plugin;
}
