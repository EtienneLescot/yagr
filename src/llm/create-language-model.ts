import { YagrConfigService, type YagrLocalConfig } from '../config/yagr-config-service.js';
import { OPENAI_ACCOUNT_BASE_URL } from './openai-account.js';
import { resolveModelCapabilityProfile } from './model-capabilities.js';
import {
  getDefaultBaseUrlForProvider,
  getDefaultModelForProvider,
  YAGR_MODEL_PROVIDERS,
  type YagrModelProvider,
} from './provider-registry.js';
import { getProviderPlugin } from './provider-plugin.js';
import { getCachedProviderModelMetadata, getSnapshotContextWindow } from './provider-metadata.js';
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

function preferEnvironmentCredentials(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.YAGR_PREFER_ENV_CREDENTIALS || '').trim());
}

function inferContextWindowTokens(provider: YagrModelProvider, modelName: string): number {
  const normalized = modelName.toLowerCase();

  if (provider === 'anthropic' || provider === 'openrouter') {
    if (normalized.includes('haiku') || normalized.includes('sonnet') || normalized.includes('opus') || normalized.includes('claude')) {
      return 200_000;
    }
  }

  if (provider === 'openai') {
    // o-series reasoning models: o1, o3, o4 and future generations
    if (/^o\d/.test(normalized)) {
      return 200_000;
    }
    // gpt-4.1 family has a 1M context window
    if (normalized.startsWith('gpt-4.1')) {
      return 1_048_576;
    }
    // gpt-5 flagship and pro/codex variants (400k) — "chat" variants ship with 128k
    if ((normalized.startsWith('gpt-5') || normalized.includes('gpt-5')) && !normalized.includes('-chat')) {
      return 400_000;
    }
    return 128_000;
  }

  if (provider === 'google') {
    return 1_000_000;
  }

  if (provider === 'mistral' || provider === 'copilot-proxy') {
    return 128_000;
  }

  return 128_000;
}

export function resolveModelContextProfile(config: YagrLanguageModelConfig = {}): YagrModelContextProfile {
  const resolvedConfig = resolveLanguageModelConfig(config);
  const cached = getCachedProviderModelMetadata(resolvedConfig.provider, resolvedConfig.model);

  const contextWindowTokens =
    cached?.contextWindow ??
    getSnapshotContextWindow(resolvedConfig.provider, resolvedConfig.model) ??
    inferContextWindowTokens(resolvedConfig.provider, resolvedConfig.model);

  return {
    provider: resolvedConfig.provider,
    model: resolvedConfig.model,
    contextWindowTokens,
    reservedOutputTokens: cached?.maxOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS,
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
  return plugin.factory.createLanguageModel({
    model: modelName,
    apiKey,
    baseUrl: baseURL,
    capabilityProfile,
  });
}

function getApiKeyForProvider(
  provider: YagrModelProvider,
  configStore: YagrLanguageModelConfigStore,
): string | undefined {
  const byProvider: Partial<Record<YagrModelProvider, string[]>> = {
    openai: ['OPENAI_LLM_API_KEY', 'OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_LLM_API_KEY', 'ANTHROPIC_API_KEY'],
    google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_LLM_API_KEY', 'GOOGLE_LLM_API_KEY'],
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

  if (preferEnvironmentCredentials()) {
    return undefined;
  }

  const configured = configStore.getApiKey(provider);
  if (configured) {
    return configured;
  }

  return undefined;
}

function getBaseUrlForProvider(
  provider: YagrModelProvider,
  configStore: YagrLanguageModelConfigStore,
): string | undefined {
  const localConfig = configStore.getLocalConfig();
  if (preferEnvironmentCredentials()) {
    const envKey = `YAGR_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL`;
    const envBaseUrl = process.env[envKey]?.trim();
    if (envBaseUrl) {
      return envBaseUrl;
    }
  }
  const configuredBaseUrl = localConfig.provider === provider ? localConfig.baseUrl : undefined;
  return configuredBaseUrl || getDefaultBaseUrlForProvider(provider);
}
