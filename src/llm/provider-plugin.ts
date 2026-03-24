import type { LanguageModelV1 } from '@ai-sdk/provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropicAccountLanguageModel } from './anthropic-account.js';
import { createGitHubCopilotLanguageModel } from './copilot-account.js';
import { createGeminiAccountLanguageModel } from './google-account.js';
import {
  getOpenAiCompatibleProviderSettingsForCapability,
  type YagrModelCapabilityProfile,
} from './model-capabilities.js';
import { createOpenAiAccountLanguageModel, getOpenAiAccountSession } from './openai-account.js';
import { fetchAndCacheProviderMetadata, primeProviderModelMetadata, warmProviderMetadataCacheFromDiscovery } from './provider-metadata.js';
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

export interface YagrProviderModelFactoryArgs {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  capabilityProfile: YagrModelCapabilityProfile;
}

export interface YagrProviderModelFactoryContract {
  createLanguageModel: (args: YagrProviderModelFactoryArgs) => LanguageModelV1;
}

export interface YagrProviderDiscoveryContract {
  fetchAvailableModels?: (args: { apiKey?: string; baseUrl?: string }) => Promise<string[]>;
}

export interface YagrProviderPlugin {
  id: YagrModelProvider;
  definition: YagrProviderDefinition;
  transport: YagrProviderTransportContract;
  factory: YagrProviderModelFactoryContract;
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
    factory: {
      createLanguageModel: buildModelFactory(provider, definition),
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

function buildModelFactory(
  provider: YagrModelProvider,
  definition: YagrProviderDefinition,
): YagrProviderModelFactoryContract['createLanguageModel'] {
  if (provider === 'anthropic') {
    return ({ model, apiKey, baseUrl }) => createAnthropic({
      apiKey,
      baseURL: baseUrl,
    })(model);
  }

  if (provider === 'openai') {
    return ({ model, apiKey, baseUrl }) => {
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
      return createOpenAI({
        apiKey,
        baseURL: baseUrl || definition.defaultBaseUrl,
        headers,
        name: provider,
        compatibility: 'compatible',
      }).responses(model);
    };
  }

  if (provider === 'openai-proxy') {
    return ({ model, capabilityProfile }) => {
      if (!getOpenAiAccountSession()?.accessToken) {
        throw new Error('OpenAI account session not found. Run `yagr setup` again.');
      }

      return createOpenAiAccountLanguageModel(model, capabilityProfile);
    };
  }

  if (provider === 'anthropic-proxy') {
    return ({ model, apiKey, capabilityProfile }) => createAnthropicAccountLanguageModel(model, apiKey, capabilityProfile);
  }

  if (provider === 'google-proxy') {
    return ({ model, capabilityProfile }) => createGeminiAccountLanguageModel(model, capabilityProfile);
  }

  if (provider === 'copilot-proxy') {
    return ({ model, capabilityProfile }) => createGitHubCopilotLanguageModel(model, capabilityProfile);
  }

  if (definition.usesOpenAiCompatibleApi) {
    return ({ model, apiKey, baseUrl, capabilityProfile }) => {
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
      const providerClient = createOpenAI({
        apiKey,
        baseURL: baseUrl || definition.defaultBaseUrl,
        headers,
        name: provider,
        compatibility: 'compatible',
        fetch: getOpenAiFetchOverride(provider),
      });
      const providerSettings = getOpenAiCompatibleProviderSettings(provider, capabilityProfile);
      return providerSettings ? providerClient(model, providerSettings) : providerClient(model);
    };
  }

  return ({ model }) => {
    throw new Error(`Provider ${provider} is not yet fully implemented for model ${model}`);
  };
}

function buildProviderDiscovery(
  provider: YagrModelProvider,
  definition: YagrProviderDefinition,
): YagrProviderDiscoveryContract | undefined {
  const discovery = definition.modelDiscovery;
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

function getOpenAiCompatibleProviderSettings(
  provider: YagrModelProvider,
  capabilityProfile: YagrModelCapabilityProfile,
):
  | { useLegacyFunctionCalling?: boolean; parallelToolCalls?: boolean; structuredOutputs?: boolean; simulateStreaming?: boolean }
  | undefined {
  const baseSettings = getOpenAiCompatibleProviderSettingsForCapability(capabilityProfile);

  if (provider === 'mistral') {
    return {
      ...baseSettings,
      simulateStreaming: true,
    };
  }

  return baseSettings;
}

function getOpenAiFetchOverride(provider: YagrModelProvider): typeof fetch | undefined {
  if (provider !== 'mistral') {
    return undefined;
  }

  return async (input, init) => {
    const response = await fetch(input, init);
    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    if (contentType.includes('text/event-stream')) {
      return response;
    }

    const payload = await response.clone().text().catch(() => '');

    if (response.ok) {
      if (payload.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          throw new Error(`Mistral API returned non-JSON payload: ${truncateForError(payload.replace(/\s+/g, ' ').trim(), 280)}`);
        }

        const normalized = normalizeMistralToolCalls(parsed);
        if (normalized !== parsed) {
          return new Response(JSON.stringify(normalized), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      }

      return response;
    }

    const compact = payload.replace(/\s+/g, ' ').trim();
    throw new Error(`Mistral API error ${response.status}: ${truncateForError(compact, 280)}`);
  };
}

function truncateForError(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function normalizeMistralToolCalls(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const root = payload as { choices?: unknown[] };
  if (!Array.isArray(root.choices) || root.choices.length === 0) {
    return payload;
  }

  let mutated = false;
  const choices = root.choices.map((choice) => {
    if (!choice || typeof choice !== 'object') {
      return choice;
    }

    const record = choice as { message?: { tool_calls?: unknown[] } };
    const toolCalls = record.message?.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return choice;
    }

    let choiceMutated = false;
    const normalizedToolCalls = toolCalls.map((toolCall) => {
      if (!toolCall || typeof toolCall !== 'object') {
        return toolCall;
      }

      const callRecord = toolCall as Record<string, unknown>;
      if (typeof callRecord.type === 'string' && callRecord.type.length > 0) {
        return toolCall;
      }

      choiceMutated = true;
      return {
        ...callRecord,
        type: 'function',
      };
    });

    if (!choiceMutated) {
      return choice;
    }

    mutated = true;
    return {
      ...(choice as Record<string, unknown>),
      message: {
        ...(record.message as Record<string, unknown>),
        tool_calls: normalizedToolCalls,
      },
    };
  });

  if (!mutated) {
    return payload;
  }

  return {
    ...(payload as Record<string, unknown>),
    choices,
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
