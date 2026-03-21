import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { YagrConfigService, type YagrLocalConfig } from '../config/yagr-config-service.js';
import { createGitHubCopilotLanguageModel } from './copilot-account.js';
import { createGeminiAccountLanguageModel } from './google-account.js';
import { createOpenAiAccountLanguageModel, getOpenAiAccountSession, OPENAI_ACCOUNT_BASE_URL } from './openai-account.js';
import {
  getDefaultBaseUrlForProvider,
  getDefaultModelForProvider,
  getProviderDefinition,
  YAGR_MODEL_PROVIDERS,
  type YagrModelProvider,
} from './provider-registry.js';
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
  const definition = getProviderDefinition(provider);
  const sessionApiKey = provider === 'openai-proxy' ? getOpenAiAccountSession()?.accessToken : undefined;
  const resolvedApiKey = apiKey || sessionApiKey;
  const headers = resolvedApiKey ? { Authorization: `Bearer ${resolvedApiKey}` } : undefined;

  if (provider === 'anthropic') {
    return createAnthropic({
      apiKey: resolvedApiKey,
      baseURL,
    })(modelName);
  }

  if (provider === 'openai-proxy') {
    if (!resolvedApiKey) {
      throw new Error('OpenAI account session not found. Run `codex --login` or `yagr setup` again.');
    }

    return createOpenAiAccountLanguageModel(modelName);
  }

  if (provider === 'google-proxy') {
    return createGeminiAccountLanguageModel(modelName);
  }

  if (provider === 'copilot-proxy') {
    return createGitHubCopilotLanguageModel(modelName);
  }

  if (definition.usesOpenAiCompatibleApi) {
    return createOpenAI({
      apiKey: resolvedApiKey,
      baseURL: baseURL || definition.defaultBaseUrl,
      headers,
      name: provider,
      compatibility: 'compatible',
    })(modelName);
  }

  throw new Error(`Provider ${provider} is not yet fully implemented in createLanguageModel`);
}

function getApiKeyForProvider(
  provider: YagrModelProvider,
  configStore: YagrLanguageModelConfigStore,
): string | undefined {
  return configStore.getApiKey(provider);
}

function getBaseUrlForProvider(
  provider: YagrModelProvider,
  configStore: YagrLanguageModelConfigStore,
): string | undefined {
  const localConfig = configStore.getLocalConfig();
  const configuredBaseUrl = localConfig.provider === provider ? localConfig.baseUrl : undefined;
  return configuredBaseUrl || getDefaultBaseUrlForProvider(provider);
}
