import type { YagrLocalConfig } from '../config/yagr-config-service.js';
import { DEFAULT_COPILOT_API_BASE_URL, GITHUB_COPILOT_DEFAULT_MODEL, GITHUB_COPILOT_MODEL_CATALOG } from './copilot-account.js';
import { GEMINI_ACCOUNT_DEFAULT_MODEL, GEMINI_ACCOUNT_MODEL_CATALOG } from './google-account.js';
import { OPENAI_ACCOUNT_BASE_URL, OPENAI_ACCOUNT_DEFAULT_MODEL, OPENAI_ACCOUNT_MODEL_CATALOG } from './openai-account.js';

export type YagrModelProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'groq'
  | 'mistral'
  | 'openrouter'
  | 'openai-proxy'
  | 'anthropic-proxy'
  | 'google-proxy'
  | 'copilot-proxy';

export interface YagrProviderDefinition {
  id: YagrModelProvider;
  displayName?: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  requiresApiKey: boolean;
  usesOpenAiCompatibleApi: boolean;
  experimental?: boolean;
  setupHint?: string;
  managedProxy?: {
    packageName: string;
    executable: string;
    args?: string[];
    readyTimeoutMs?: number;
    startupNotes?: string[];
  };
  modelDiscovery?: {
    buildUrl: (baseUrl?: string) => string | undefined;
    authMode: 'bearer-optional' | 'bearer-required' | 'none';
    mapResponse: (data: Record<string, unknown>) => string[];
  };
}

const MODEL_LIST_MAPPER = (data: Record<string, unknown>) =>
  (data.data as Array<{ id: string }> | undefined)?.map((model) => model.id) ?? [];

export const YAGR_PROVIDER_DEFINITIONS: Record<YagrModelProvider, YagrProviderDefinition> = {
  anthropic: {
    id: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-latest',
    requiresApiKey: true,
    usesOpenAiCompatibleApi: false,
  },
  openai: {
    id: 'openai',
    displayName: 'OpenAI API Key',
    defaultModel: 'gpt-4o',
    requiresApiKey: true,
    usesOpenAiCompatibleApi: true,
    setupHint: 'API key',
    modelDiscovery: {
      buildUrl: () => 'https://api.openai.com/v1/models',
      authMode: 'bearer-required',
      mapResponse: MODEL_LIST_MAPPER,
    },
  },
  google: {
    id: 'google',
    displayName: 'Gemini API Key',
    defaultModel: 'gemini-1.5-pro-latest',
    requiresApiKey: true,
    usesOpenAiCompatibleApi: false,
  },
  groq: {
    id: 'groq',
    displayName: 'Groq API Key',
    defaultModel: 'llama-3.1-70b-versatile',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresApiKey: true,
    usesOpenAiCompatibleApi: true,
    modelDiscovery: {
      buildUrl: () => 'https://api.groq.com/openai/v1/models',
      authMode: 'bearer-required',
      mapResponse: MODEL_LIST_MAPPER,
    },
  },
  mistral: {
    id: 'mistral',
    displayName: 'Mistral API Key',
    defaultModel: 'mistral-large-latest',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    requiresApiKey: true,
    usesOpenAiCompatibleApi: true,
    modelDiscovery: {
      buildUrl: () => 'https://api.mistral.ai/v1/models',
      authMode: 'bearer-required',
      mapResponse: MODEL_LIST_MAPPER,
    },
  },
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter API Key',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    usesOpenAiCompatibleApi: true,
    modelDiscovery: {
      buildUrl: () => 'https://openrouter.ai/api/v1/models',
      authMode: 'bearer-required',
      mapResponse: MODEL_LIST_MAPPER,
    },
  },
  'openai-proxy': {
    id: 'openai-proxy',
    displayName: 'OpenAI OAuth',
    defaultModel: OPENAI_ACCOUNT_DEFAULT_MODEL,
    defaultBaseUrl: OPENAI_ACCOUNT_BASE_URL,
    requiresApiKey: false,
    usesOpenAiCompatibleApi: true,
    setupHint: 'Use your ChatGPT account, no API key',
  },
  'anthropic-proxy': {
    id: 'anthropic-proxy',
    displayName: 'Claude OAuth',
    defaultModel: 'claude-sonnet-4',
    defaultBaseUrl: 'http://127.0.0.1:3456/v1',
    experimental: true,
    requiresApiKey: false,
    usesOpenAiCompatibleApi: true,
    setupHint: 'Manual local proxy',
    modelDiscovery: {
      buildUrl: normalizeProxyModelsUrl,
      authMode: 'bearer-optional',
      mapResponse: MODEL_LIST_MAPPER,
    },
  },
  'google-proxy': {
    id: 'google-proxy',
    displayName: 'Gemini OAuth',
    defaultModel: GEMINI_ACCOUNT_DEFAULT_MODEL,
    requiresApiKey: false,
    usesOpenAiCompatibleApi: false,
    setupHint: 'Use your Google/Gemini account, no API key',
  },
  'copilot-proxy': {
    id: 'copilot-proxy',
    displayName: 'GitHub Copilot OAuth',
    defaultModel: GITHUB_COPILOT_DEFAULT_MODEL,
    defaultBaseUrl: DEFAULT_COPILOT_API_BASE_URL,
    requiresApiKey: false,
    usesOpenAiCompatibleApi: true,
    setupHint: 'Use your GitHub Copilot subscription, no API key',
  },
};

export const YAGR_MODEL_PROVIDERS = Object.freeze(Object.keys(YAGR_PROVIDER_DEFINITIONS) as YagrModelProvider[]);

export function getProviderDefinition(provider: YagrModelProvider): YagrProviderDefinition {
  return YAGR_PROVIDER_DEFINITIONS[provider];
}

export function getDefaultBaseUrlForProvider(provider: YagrModelProvider): string | undefined {
  return getProviderDefinition(provider).defaultBaseUrl;
}

export function getDefaultModelForProvider(provider: YagrModelProvider): string {
  return getProviderDefinition(provider).defaultModel;
}

export function providerNeedsBaseUrlInput(provider: YagrModelProvider): boolean {
  if (isOAuthAccountProvider(provider)) {
    return false;
  }

  return provider.endsWith('-proxy') || provider === 'groq' || provider === 'mistral' || provider === 'openrouter';
}

export function providerRequiresApiKey(provider: YagrModelProvider): boolean {
  return getProviderDefinition(provider).requiresApiKey;
}

export function isExperimentalProvider(provider: YagrModelProvider): boolean {
  return getProviderDefinition(provider).experimental === true;
}

export function getProviderSetupHint(provider: YagrModelProvider): string | undefined {
  return getProviderDefinition(provider).setupHint;
}

export function getProviderDisplayName(provider: YagrModelProvider): string {
  return getProviderDefinition(provider).displayName ?? provider;
}

export function isOAuthAccountProvider(provider: YagrModelProvider): boolean {
  return provider === 'openai-proxy' || provider === 'google-proxy' || provider === 'copilot-proxy';
}

export function isProviderConfigured(localConfig: YagrLocalConfig, getApiKey: (provider: YagrModelProvider) => string | undefined): boolean {
  if (!localConfig.provider || !localConfig.model) {
    return false;
  }

  const definition = getProviderDefinition(localConfig.provider);
  if (definition.requiresApiKey && !getApiKey(localConfig.provider)) {
    return false;
  }

  if (providerNeedsBaseUrlInput(localConfig.provider) && !(localConfig.baseUrl || definition.defaultBaseUrl)) {
    return false;
  }

  return true;
}

function normalizeProxyModelsUrl(baseUrl?: string): string | undefined {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return undefined;
  }

  return normalizedBaseUrl.endsWith('/models') ? normalizedBaseUrl : `${normalizedBaseUrl}/models`;
}

export function getStaticModelCatalogForProvider(provider: YagrModelProvider): string[] {
  if (provider === 'openai-proxy') {
    return [...OPENAI_ACCOUNT_MODEL_CATALOG];
  }

  if (provider === 'google-proxy') {
    return [...GEMINI_ACCOUNT_MODEL_CATALOG];
  }

  if (provider === 'copilot-proxy') {
    return [...GITHUB_COPILOT_MODEL_CATALOG];
  }

  return [];
}

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
