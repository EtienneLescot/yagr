import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { YagrConfigService, type YagrLocalConfig } from '../config/yagr-config-service.js';
import { createAnthropicAccountLanguageModel } from './anthropic-account.js';
import { createGitHubCopilotLanguageModel } from './copilot-account.js';
import { createGeminiAccountLanguageModel } from './google-account.js';
import { createOpenAiAccountLanguageModel, getOpenAiAccountSession, OPENAI_ACCOUNT_BASE_URL } from './openai-account.js';
import {
  getOpenAiCompatibleProviderSettingsForCapability,
  resolveModelCapabilityProfile,
  type YagrModelCapabilityProfile,
} from './model-capabilities.js';
import {
  getDefaultBaseUrlForProvider,
  getDefaultModelForProvider,
  getProviderDefinition,
  YAGR_MODEL_PROVIDERS,
  type YagrModelProvider,
} from './provider-registry.js';
import { getProviderPlugin } from './provider-plugin.js';
export type { YagrModelProvider } from './provider-registry.js';

export interface YagrModelContextProfile {
  provider: YagrModelProvider;
  model: string;
  contextWindowTokens: number;
  reservedOutputTokens: number;
}

export interface YagrLanguageModelConfig {
  provider?: YagrModelProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ResolvedYagrLanguageModelConfig {
  provider: YagrModelProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

interface YagrLanguageModelConfigStore {
  getLocalConfig(): YagrLocalConfig;
  getApiKey(provider: YagrModelProvider): string | undefined;
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_RESERVED_OUTPUT_TOKENS = 8_192;
const KNOWN_MODEL_PROVIDERS: YagrModelProvider[] = [...YAGR_MODEL_PROVIDERS];

function inferContextWindowTokens(provider: YagrModelProvider, modelName: string): number {
  const normalized = modelName.toLowerCase();

  if (provider === 'anthropic' || provider === 'openrouter') {
    if (normalized.includes('haiku') || normalized.includes('sonnet') || normalized.includes('opus') || normalized.includes('claude')) {
      return 200_000;
    }
  }

  if (provider === 'openai') {
    if (normalized.startsWith('gpt-5') || normalized.includes('gpt-5')) {
      return 400_000;
    }
    if (normalized.startsWith('o1') || normalized.startsWith('o3')) {
      return 200_000;
    }
    return 128_000;
  }

  if (provider === 'google' || provider === 'google-proxy') {
    return 1_000_000;
  }

  if (provider === 'groq' || provider === 'mistral' || provider === 'copilot-proxy') {
    return 128_000;
  }

  return 128_000;
}

export function resolveModelContextProfile(config: YagrLanguageModelConfig = {}): YagrModelContextProfile {
  const resolvedConfig = resolveLanguageModelConfig(config);

  return {
    provider: resolvedConfig.provider,
    model: resolvedConfig.model,
    contextWindowTokens: inferContextWindowTokens(resolvedConfig.provider, resolvedConfig.model),
    reservedOutputTokens: DEFAULT_RESERVED_OUTPUT_TOKENS,
  };
}

export function resolveModelProvider(
  explicitProvider?: string,
  configStore: YagrLanguageModelConfigStore = new YagrConfigService(),
): YagrModelProvider {
  if (explicitProvider) {
    return explicitProvider as YagrModelProvider;
  }

  const localConfig = configStore.getLocalConfig();
  if (localConfig.provider) {
    return localConfig.provider;
  }

  const detectedProvider = KNOWN_MODEL_PROVIDERS.find((provider) => Boolean(configStore.getApiKey(provider)));
  if (detectedProvider) {
    return detectedProvider;
  }

  throw new Error('No valid AI provider detected. Run `yagr setup` first.');
}

export function resolveModelName(
  provider: YagrModelProvider,
  explicitModel?: string,
  configStore: YagrLanguageModelConfigStore = new YagrConfigService(),
): string {
  if (explicitModel) {
    return explicitModel;
  }

  const localConfig = configStore.getLocalConfig();
  if (localConfig.provider === provider && localConfig.model) {
    return localConfig.model;
  }

  if (provider === 'anthropic') {
    return DEFAULT_ANTHROPIC_MODEL;
  }

  if (provider === 'openai') {
    return DEFAULT_OPENAI_MODEL;
  }

  return getDefaultModelForProvider(provider);
}

export function resolveLanguageModelConfig(
  config: YagrLanguageModelConfig = {},
  configStore: YagrLanguageModelConfigStore = new YagrConfigService(),
): ResolvedYagrLanguageModelConfig {
  const provider = resolveModelProvider(config.provider, configStore);

  return {
    provider,
    model: resolveModelName(provider, config.model, configStore),
    apiKey: config.apiKey || getApiKeyForProvider(provider, configStore),
    baseUrl: config.baseUrl || getBaseUrlForProvider(provider, configStore),
  };
}

export function createLanguageModel(config: YagrLanguageModelConfig = {}) {
  const resolvedConfig = resolveLanguageModelConfig(config);
  const { provider, model: modelName, apiKey, baseUrl: baseURL } = resolvedConfig;
  const capabilityProfile = resolveModelCapabilityProfile({ provider, model: modelName });
  const plugin = getProviderPlugin(provider);
  const definition = plugin.definition;
  const sessionApiKey = provider === 'openai-proxy' ? getOpenAiAccountSession()?.accessToken : undefined;
  const resolvedApiKey = apiKey || sessionApiKey;
  const headers = resolvedApiKey ? { Authorization: `Bearer ${resolvedApiKey}` } : undefined;

  if (provider === 'anthropic') {
    return createAnthropic({
      apiKey: resolvedApiKey,
      baseURL,
    })(modelName);
  }

  if (provider === 'openai') {
    const openaiProvider = createOpenAI({
      apiKey: resolvedApiKey,
      baseURL: baseURL || definition.defaultBaseUrl,
      headers,
      name: provider,
      compatibility: 'compatible',
    });
    // SSOT for direct OpenAI API-key provider:
    // route all text generation through the Responses API.
    return openaiProvider.responses(modelName);
  }

  if (provider === 'openai-proxy') {
    if (!resolvedApiKey) {
      throw new Error('OpenAI account session not found. Run `yagr setup` again.');
    }

    return createOpenAiAccountLanguageModel(modelName, capabilityProfile);
  }

  if (provider === 'anthropic-proxy') {
    return createAnthropicAccountLanguageModel(modelName, resolvedApiKey, capabilityProfile);
  }

  if (provider === 'google-proxy') {
    return createGeminiAccountLanguageModel(modelName, capabilityProfile);
  }

  if (provider === 'copilot-proxy') {
    return createGitHubCopilotLanguageModel(modelName, capabilityProfile);
  }

  if (plugin.transport.usesOpenAiCompatibleApi) {
    const providerClient = createOpenAI({
      apiKey: resolvedApiKey,
      baseURL: baseURL || definition.defaultBaseUrl,
      headers,
      name: provider,
      compatibility: getOpenAiCompatibilityMode(provider),
      fetch: getOpenAiFetchOverride(provider),
    });

    const providerSettings = getOpenAiCompatibleProviderSettings(provider, capabilityProfile);
    return providerSettings
      ? providerClient(modelName, providerSettings)
      : providerClient(modelName);
  }

  throw new Error(`Provider ${provider} is not yet fully implemented in createLanguageModel`);
}

function getOpenAiCompatibilityMode(provider: YagrModelProvider): 'strict' | 'compatible' {
  return 'compatible';
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
      // Mistral OpenAI-compatible endpoints can emit non-JSON fragments during tool
      // argument generation; disabling strict structured parsing avoids hard failures.
      simulateStreaming: true,
    };
  }

  return baseSettings;
}

function getApiKeyForProvider(
  provider: YagrModelProvider,
  configStore: YagrLanguageModelConfigStore,
): string | undefined {
  const configured = configStore.getApiKey(provider);
  if (configured) {
    return configured;
  }

  const byProvider: Partial<Record<YagrModelProvider, string[]>> = {
    openai: ['OPENAI_LLM_API_KEY', 'OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_LLM_API_KEY', 'ANTHROPIC_API_KEY'],
    google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_LLM_API_KEY', 'GOOGLE_LLM_API_KEY'],
    groq: ['GROQ_API_KEY', 'GROQ_LLM_API_KEY'],
    mistral: ['MISTRAL_API_KEY', 'MISTRAL_LLM_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY', 'OPENROUTER_LLM_API_KEY'],
  };

  const envKeys = byProvider[provider] ?? [];
  for (const envKey of envKeys) {
    const value = process.env[envKey]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function getBaseUrlForProvider(
  provider: YagrModelProvider,
  configStore: YagrLanguageModelConfigStore,
): string | undefined {
  const localConfig = configStore.getLocalConfig();
  const configuredBaseUrl = localConfig.provider === provider ? localConfig.baseUrl : undefined;
  return configuredBaseUrl || getDefaultBaseUrlForProvider(provider);
}
