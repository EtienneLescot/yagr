import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatMistralAI } from '@langchain/mistralai';
import { ChatOpenAI } from '@langchain/openai';

export type RuntimeProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'mistral'
  | 'openrouter'
  | 'openai-compatible';

export interface ProviderRuntimeConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
}

export interface ResolvedProviderRuntimeConfig {
  provider: RuntimeProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature: number;
}

const PROVIDER_DEFAULTS: Record<RuntimeProvider, { model: string; baseUrl?: string; envKeys: string[] }> = {
  anthropic: {
    model: 'claude-3-5-sonnet-latest',
    envKeys: ['ANTHROPIC_API_KEY'],
  },
  openai: {
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    envKeys: ['OPENAI_API_KEY'],
  },
  google: {
    model: 'gemini-3-flash-preview',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  },
  mistral: {
    model: 'mistral-large-latest',
    baseUrl: 'https://api.mistral.ai/v1',
    envKeys: ['MISTRAL_API_KEY'],
  },
  openrouter: {
    model: 'anthropic/claude-3.5-sonnet',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKeys: ['OPENROUTER_API_KEY'],
  },
  'openai-compatible': {
    model: '',
    envKeys: ['OPENAI_COMPATIBLE_API_KEY'],
  },
};

const PROVIDER_LABELS: Record<RuntimeProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  'openai-compatible': 'OpenAI Compatible',
};

export function normalizeProviderId(provider?: string): RuntimeProvider | undefined {
  if (!provider) {
    return undefined;
  }
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'claude') return 'anthropic';
  if (normalized === 'gemini') return 'google';
  if (normalized === 'openai-compatible') return 'openai-compatible';
  if (normalized in PROVIDER_DEFAULTS) {
    return normalized as RuntimeProvider;
  }
  return undefined;
}

export function resolveProviderRuntimeConfig(config: ProviderRuntimeConfig = {}): ResolvedProviderRuntimeConfig {
  const provider = normalizeProviderId(config.provider) ?? detectProviderFromEnvironment() ?? 'openai';
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    provider,
    model: config.model?.trim() || defaults.model,
    apiKey: config.apiKey?.trim() || readEnvKey(defaults.envKeys),
    baseUrl: config.baseUrl?.trim() || defaults.baseUrl,
    temperature: config.temperature ?? 0,
  };
}

export function listRuntimeProviders(): RuntimeProvider[] {
  return Object.keys(PROVIDER_DEFAULTS) as RuntimeProvider[];
}

export function getRuntimeProviderLabel(provider: RuntimeProvider): string {
  return PROVIDER_LABELS[provider];
}

export function getDefaultModelForProvider(provider: RuntimeProvider): string {
  return PROVIDER_DEFAULTS[provider].model;
}

export function getDefaultBaseUrlForProvider(provider: RuntimeProvider): string | undefined {
  return PROVIDER_DEFAULTS[provider].baseUrl;
}

export function providerRequiresApiKey(provider: RuntimeProvider): boolean {
  return PROVIDER_DEFAULTS[provider].envKeys.length > 0;
}

export function createLangChainChatModel(config: ProviderRuntimeConfig = {}): BaseChatModel {
  const resolved = resolveProviderRuntimeConfig(config);
  switch (resolved.provider) {
    case 'anthropic':
      return new ChatAnthropic({
        apiKey: requiredApiKey(resolved),
        model: resolved.model,
        temperature: resolved.temperature,
      });
    case 'google':
      return new ChatGoogleGenerativeAI({
        apiKey: requiredApiKey(resolved),
        model: resolved.model,
        temperature: resolved.temperature,
      } as ConstructorParameters<typeof ChatGoogleGenerativeAI>[0]);
    case 'mistral':
      return new ChatMistralAI({
        apiKey: requiredApiKey(resolved),
        model: resolved.model,
        temperature: resolved.temperature,
      } as ConstructorParameters<typeof ChatMistralAI>[0]);
    case 'openrouter':
    case 'openai':
    case 'openai-compatible':
      return new ChatOpenAI({
        ...(resolved.apiKey ? { apiKey: resolved.apiKey } : {}),
        model: resolved.model,
        temperature: resolved.temperature,
        ...(resolved.baseUrl ? { configuration: { baseURL: resolved.baseUrl } } : {}),
      });
  }
}

function requiredApiKey(config: ResolvedProviderRuntimeConfig): string {
  if (!config.apiKey) {
    throw new Error(`Missing API key for provider ${config.provider}.`);
  }
  return config.apiKey;
}

function detectProviderFromEnvironment(): RuntimeProvider | undefined {
  const providers = Object.entries(PROVIDER_DEFAULTS) as Array<[RuntimeProvider, { envKeys: string[] }]>
  return providers.find(([, value]) => Boolean(readEnvKey(value.envKeys)))?.[0];
}

function readEnvKey(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}
