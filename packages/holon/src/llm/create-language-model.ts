import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { HolonConfigService, type HolonLocalConfig } from '../config/holon-config-service.js';

export type HolonModelProvider = 'anthropic' | 'openai' | 'google' | 'groq' | 'mistral' | 'openrouter';

export interface HolonModelContextProfile {
  provider: HolonModelProvider;
  model: string;
  contextWindowTokens: number;
  reservedOutputTokens: number;
}

export interface HolonLanguageModelConfig {
  provider?: HolonModelProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ResolvedHolonLanguageModelConfig {
  provider: HolonModelProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

interface HolonLanguageModelConfigStore {
  getLocalConfig(): HolonLocalConfig;
  getApiKey(provider: HolonModelProvider): string | undefined;
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';
const DEFAULT_RESERVED_OUTPUT_TOKENS = 8_192;
const KNOWN_MODEL_PROVIDERS: HolonModelProvider[] = ['anthropic', 'openai', 'google', 'groq', 'mistral', 'openrouter'];

function inferContextWindowTokens(provider: HolonModelProvider, modelName: string): number {
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

  if (provider === 'google') {
    return 1_000_000;
  }

  if (provider === 'groq' || provider === 'mistral') {
    return 128_000;
  }

  return 128_000;
}

export function resolveModelContextProfile(config: HolonLanguageModelConfig = {}): HolonModelContextProfile {
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
  configStore: HolonLanguageModelConfigStore = new HolonConfigService(),
): HolonModelProvider {
  if (explicitProvider) {
    return explicitProvider as HolonModelProvider;
  }

  const localConfig = configStore.getLocalConfig();
  if (localConfig.provider) {
    return localConfig.provider;
  }

  const detectedProvider = KNOWN_MODEL_PROVIDERS.find((provider) => Boolean(configStore.getApiKey(provider)));
  if (detectedProvider) {
    return detectedProvider;
  }

  throw new Error('No valid AI provider detected. Run `holon setup` first.');
}

export function resolveModelName(
  provider: HolonModelProvider,
  explicitModel?: string,
  configStore: HolonLanguageModelConfigStore = new HolonConfigService(),
): string {
  if (explicitModel) {
    return explicitModel;
  }

  const localConfig = configStore.getLocalConfig();
  if (localConfig.provider === provider && localConfig.model) {
    return localConfig.model;
  }

  switch (provider) {
    case 'openrouter': return DEFAULT_OPENROUTER_MODEL;
    case 'anthropic': return DEFAULT_ANTHROPIC_MODEL;
    case 'openai': return DEFAULT_OPENAI_MODEL;
    case 'google': return 'gemini-1.5-pro-latest';
    case 'groq': return 'llama-3.1-70b-versatile';
    case 'mistral': return 'mistral-large-latest';
    default: return DEFAULT_OPENAI_MODEL;
  }
}

export function resolveLanguageModelConfig(
  config: HolonLanguageModelConfig = {},
  configStore: HolonLanguageModelConfigStore = new HolonConfigService(),
): ResolvedHolonLanguageModelConfig {
  const provider = resolveModelProvider(config.provider, configStore);

  return {
    provider,
    model: resolveModelName(provider, config.model, configStore),
    apiKey: config.apiKey || getApiKeyForProvider(provider, configStore),
    baseUrl: config.baseUrl || getBaseUrlForProvider(provider, configStore),
  };
}

export function createLanguageModel(config: HolonLanguageModelConfig = {}) {
  const resolvedConfig = resolveLanguageModelConfig(config);
  const { provider, model: modelName, apiKey, baseUrl: baseURL } = resolvedConfig;
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;

  if (provider === 'openrouter') {
    return createOpenAI({
      apiKey,
      baseURL: baseURL || 'https://openrouter.ai/api/v1',
      headers,
      name: 'openrouter',
      compatibility: 'compatible',
    })(modelName);
  }

  if (provider === 'anthropic') {
    return createAnthropic({
      apiKey,
      baseURL,
    })(modelName);
  }

  // Default to OpenAI-compatible for others if possible, or specialized providers
  if (provider === 'openai' || provider === 'groq' || provider === 'mistral') {
    return createOpenAI({
      apiKey,
      baseURL,
      headers,
      name: provider,
      compatibility: 'compatible',
    })(modelName);
  }

  throw new Error(`Provider ${provider} is not yet fully implemented in createLanguageModel`);
}

function getApiKeyForProvider(
  provider: HolonModelProvider,
  configStore: HolonLanguageModelConfigStore,
): string | undefined {
  return configStore.getApiKey(provider);
}

function getBaseUrlForProvider(
  provider: HolonModelProvider,
  configStore: HolonLanguageModelConfigStore,
): string | undefined {
  const localConfig = configStore.getLocalConfig();
  const configuredBaseUrl = localConfig.provider === provider ? localConfig.baseUrl : undefined;

  switch (provider) {
    case 'openai': return configuredBaseUrl;
    case 'anthropic': return configuredBaseUrl;
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'mistral': return 'https://api.mistral.ai/v1';
    default: return undefined;
  }
}
