import { DEFAULT_COPILOT_API_BASE_URL, GITHUB_COPILOT_DEFAULT_MODEL } from './copilot-account.js';
import { ANTHROPIC_ACCOUNT_DEFAULT_MODEL } from './anthropic-account.js';
import { OPENAI_ACCOUNT_BASE_URL, OPENAI_ACCOUNT_DEFAULT_MODEL } from './openai-account.js';
const MODEL_LIST_MAPPER = (data) => data.data?.map((model) => model.id) ?? [];
function getMiniMaxDiscoveryUrl(baseUrl) {
    if (!baseUrl) {
        return 'https://api.minimaxi.com/v1/models';
    }
    return baseUrl.replace(/\/anthropic\/?$/, '/v1/models');
}
const GOOGLE_OPENAI_MODEL_LIST_MAPPER = (data) => data.data
    ?.map((model) => model.id?.replace(/^models\//, ''))
    .filter((id) => typeof id === 'string' && /^gemini-/i.test(id))
    .filter((id) => Boolean(id))
    ?? [];
export const YAGR_PROVIDER_DEFINITIONS = {
    anthropic: {
        id: 'anthropic',
        displayName: 'Claude',
        defaultModel: 'claude-haiku-4-5',
        requiresApiKey: true,
        usesOpenAiCompatibleApi: false,
        modelDiscovery: {
            buildUrl: () => 'https://api.anthropic.com/v1/models',
            authMode: 'x-api-key-required',
            mapResponse: MODEL_LIST_MAPPER,
        },
    },
    openai: {
        id: 'openai',
        displayName: 'OpenAI',
        defaultModel: 'gpt-4o',
        defaultBaseUrl: 'https://api.openai.com/v1',
        requiresApiKey: true,
        usesOpenAiCompatibleApi: true,
        modelDiscovery: {
            buildUrl: () => 'https://api.openai.com/v1/models',
            authMode: 'bearer-required',
            mapResponse: MODEL_LIST_MAPPER,
        },
    },
    google: {
        id: 'google',
        displayName: 'Gemini',
        defaultModel: 'gemini-3-flash-preview',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        requiresApiKey: true,
        usesOpenAiCompatibleApi: true,
        modelDiscovery: {
            buildUrl: () => 'https://generativelanguage.googleapis.com/v1beta/openai/models',
            authMode: 'bearer-required',
            mapResponse: GOOGLE_OPENAI_MODEL_LIST_MAPPER,
        },
    },
    mistral: {
        id: 'mistral',
        displayName: 'Mistral',
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
        displayName: 'OpenRouter',
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
    'openai-oauth': {
        id: 'openai-oauth',
        displayName: 'OpenAI',
        defaultModel: OPENAI_ACCOUNT_DEFAULT_MODEL,
        defaultBaseUrl: OPENAI_ACCOUNT_BASE_URL,
        requiresApiKey: false,
        usesOpenAiCompatibleApi: true,
        setupHint: 'ChatGPT subscription, no API key required',
        modelDiscovery: {
            buildUrl: () => `${OPENAI_ACCOUNT_BASE_URL}/codex/models`,
            authMode: 'bearer-required',
            mapResponse: MODEL_LIST_MAPPER,
        },
    },
    'anthropic-proxy': {
        id: 'anthropic-proxy',
        displayName: 'Claude',
        defaultModel: ANTHROPIC_ACCOUNT_DEFAULT_MODEL,
        requiresApiKey: false,
        usesOpenAiCompatibleApi: false,
        setupHint: 'Claude setup-token from `claude setup-token`',
    },
    'copilot-proxy': {
        id: 'copilot-proxy',
        displayName: 'GitHub',
        defaultModel: GITHUB_COPILOT_DEFAULT_MODEL,
        defaultBaseUrl: DEFAULT_COPILOT_API_BASE_URL,
        requiresApiKey: false,
        usesOpenAiCompatibleApi: true,
        setupHint: 'Copilot subscription, no API key required',
    },
    minimax: {
        id: 'minimax',
        displayName: 'MiniMax',
        defaultModel: 'MiniMax-M2.7',
        defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
        requiresApiKey: true,
        usesOpenAiCompatibleApi: false,
        modelDiscovery: {
            buildUrl: getMiniMaxDiscoveryUrl,
            authMode: 'bearer-required',
            mapResponse: MODEL_LIST_MAPPER,
        },
    },
    'minimax-token-plan': {
        id: 'minimax-token-plan',
        displayName: 'MiniMax Token Plan',
        defaultModel: 'MiniMax-M2.7',
        defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
        requiresApiKey: true,
        usesOpenAiCompatibleApi: false,
        modelDiscovery: {
            buildUrl: getMiniMaxDiscoveryUrl,
            authMode: 'bearer-required',
            mapResponse: MODEL_LIST_MAPPER,
        },
    },
    'openai-compatible': {
        id: 'openai-compatible',
        displayName: 'OpenAI Compatible',
        defaultModel: '',
        requiresApiKey: false,
        usesOpenAiCompatibleApi: true,
        modelDiscovery: {
            buildUrl: (baseUrl) => baseUrl ? `${baseUrl}/models` : undefined,
            authMode: 'bearer-optional',
            mapResponse: MODEL_LIST_MAPPER,
        },
    },
};
export const YAGR_MODEL_PROVIDERS = Object.freeze(Object.keys(YAGR_PROVIDER_DEFINITIONS));
export const YAGR_SUPPORTED_MODEL_PROVIDERS = Object.freeze(YAGR_MODEL_PROVIDERS.filter((provider) => YAGR_PROVIDER_DEFINITIONS[provider].supported !== false));
const YAGR_HIDDEN_SELECTABLE_MODEL_PROVIDERS = new Set([
    'anthropic-proxy',
]);
export const YAGR_SELECTABLE_MODEL_PROVIDERS = Object.freeze(YAGR_SUPPORTED_MODEL_PROVIDERS.filter((provider) => {
    if (YAGR_HIDDEN_SELECTABLE_MODEL_PROVIDERS.has(provider)) {
        return false;
    }
    return !isOAuthAccountProvider(provider) || isSupportedProvider(provider);
}));
export function getProviderDefinition(provider) {
    return YAGR_PROVIDER_DEFINITIONS[provider];
}
export function getDefaultBaseUrlForProvider(provider) {
    return getProviderDefinition(provider).defaultBaseUrl;
}
export function getDefaultModelForProvider(provider) {
    return getProviderDefinition(provider).defaultModel;
}
export function providerNeedsBaseUrlInput(provider) {
    if (isOAuthAccountProvider(provider)) {
        return false;
    }
    return provider.endsWith('-proxy') || provider === 'mistral' || provider === 'openrouter' || provider === 'openai-compatible';
}
export function providerRequiresApiKey(provider) {
    return getProviderDefinition(provider).requiresApiKey;
}
export function isExperimentalProvider(provider) {
    return getProviderDefinition(provider).experimental === true;
}
export function isSupportedProvider(provider) {
    return getProviderDefinition(provider).supported !== false;
}
export function getProviderSetupHint(provider) {
    return getProviderDefinition(provider).setupHint;
}
export function getProviderDisplayName(provider) {
    return getProviderDefinition(provider).displayName ?? provider;
}
export function isOAuthAccountProvider(provider) {
    return provider === 'openai-oauth' || provider === 'anthropic-proxy' || provider === 'copilot-proxy';
}
export function normalizeProviderId(provider) {
    if (!provider) {
        return undefined;
    }
    if (provider in YAGR_PROVIDER_DEFINITIONS) {
        return provider;
    }
    return undefined;
}
export function isProviderConfigured(localConfig, getApiKey) {
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
function normalizeProxyModelsUrl(baseUrl) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    if (!normalizedBaseUrl) {
        return undefined;
    }
    return normalizedBaseUrl.endsWith('/models') ? normalizedBaseUrl : `${normalizedBaseUrl}/models`;
}
function normalizeBaseUrl(baseUrl) {
    const trimmed = baseUrl?.trim();
    if (!trimmed) {
        return undefined;
    }
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
//# sourceMappingURL=provider-registry.js.map