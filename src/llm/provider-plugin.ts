import { fetchAndCacheProviderMetadata, primeProviderModelMetadata, warmProviderMetadataCacheFromDiscovery } from './provider-metadata.js';
import {
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

export interface YagrProviderPlugin {
  id: YagrModelProvider;
  definition: YagrProviderDefinition;
  transport: YagrProviderTransportContract;
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

  if (provider === 'openrouter') {
    plugin.metadata = {
      warmDiscoveryPayload: (payload) => {
        warmProviderMetadataCacheFromDiscovery(provider, payload);
      },
      primeModelMetadata: async ({ model, apiKey, baseUrl }) => {
        await primeProviderModelMetadata(provider, model, apiKey, baseUrl);
      },
    };
  } else if (definition.modelDiscovery) {
    plugin.metadata = {
      warmDiscoveryPayload: (payload) => {
        warmProviderMetadataCacheFromDiscovery(provider, payload);
      },
      primeModelMetadata: async ({ apiKey, baseUrl }) => {
        await fetchAndCacheProviderMetadata(provider, apiKey, baseUrl).catch(() => undefined);
      },
    };
  }

  return plugin;
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
