/**
 * LangChain model factory.
 *
 * Returns a `BaseChatModel` (LangChain) for the configured Yagr provider.
 * Also exports the model resolution utilities (`resolveLanguageModelConfig`,
 * `resolveModelProvider`, `resolveModelName`) that are shared with the rest
 * of the codebase. The legacy Vercel AI SDK factory (`createLanguageModel`)
 * has been removed — deepagentsjs is the only agent runtime.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI, ChatOpenAICompletions } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatMistralAI } from '@langchain/mistralai';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { getDefaultBaseUrlForProvider, getDefaultModelForProvider, normalizeProviderId, YAGR_MODEL_PROVIDERS, } from './provider-registry.js';
import { resolveCopilotApiToken, getGitHubCopilotSession } from './copilot-account.js';
import { getOpenAiAccountSession } from './openai-account.js';
import { getAnthropicAccountSession } from './anthropic-account.js';
import { ChatCodexOAuth } from './chat-codex-oauth.js';
// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const KNOWN_MODEL_PROVIDERS = [...YAGR_MODEL_PROVIDERS];
// ─── Resolution utilities ─────────────────────────────────────────────────────
function preferEnvironmentCredentials() {
    return /^(1|true|yes|on)$/i.test(String(process.env.YAGR_PREFER_ENV_CREDENTIALS || '').trim());
}
function getApiKeyForProvider(provider, configStore) {
    const byProvider = {
        openai: ['OPENAI_LLM_API_KEY', 'OPENAI_API_KEY'],
        anthropic: ['ANTHROPIC_LLM_API_KEY', 'ANTHROPIC_API_KEY'],
        google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_LLM_API_KEY', 'GOOGLE_LLM_API_KEY'],
        mistral: ['MISTRAL_API_KEY', 'MISTRAL_LLM_API_KEY'],
        openrouter: ['OPENROUTER_API_KEY', 'OPENROUTER_LLM_API_KEY'],
        minimax: ['MINIMAX_API_KEY'],
        'minimax-token-plan': ['MINIMAX_TOKEN_PLAN_API_KEY'],
        'openai-compatible': ['OPENAI_COMPATIBLE_API_KEY'],
    };
    if (!preferEnvironmentCredentials()) {
        const storedApiKey = configStore.getApiKey(provider)?.trim();
        if (storedApiKey) {
            return storedApiKey;
        }
    }
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
    return configStore.getApiKey(provider) ?? undefined;
}
function getBaseUrlForProvider(provider, configStore) {
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
export function resolveModelProvider(explicitProvider, configStore = new YagrConfigService()) {
    if (explicitProvider) {
        return normalizeProviderId(explicitProvider) ?? explicitProvider;
    }
    const localConfig = configStore.getLocalConfig();
    if (localConfig.provider) {
        return normalizeProviderId(localConfig.provider) ?? localConfig.provider;
    }
    const detectedProvider = KNOWN_MODEL_PROVIDERS.find((provider) => Boolean(configStore.getApiKey(provider)));
    if (detectedProvider) {
        return detectedProvider;
    }
    throw new Error('No valid AI provider detected. Run `yagr setup` first.');
}
export function resolveModelName(provider, explicitModel, configStore = new YagrConfigService()) {
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
export function resolveLanguageModelConfig(config = {}, configStore = new YagrConfigService()) {
    const provider = resolveModelProvider(config.provider, configStore);
    return {
        provider,
        model: resolveModelName(provider, config.model, configStore),
        apiKey: config.apiKey || getApiKeyForProvider(provider, configStore),
        baseUrl: config.baseUrl || getBaseUrlForProvider(provider, configStore),
    };
}
// ─── LangChain factory ────────────────────────────────────────────────────────
/**
 * GitHub Copilot sends these headers on every request so the API can
 * attribute usage correctly. Values match VS Code Copilot Chat plugin.
 */
const COPILOT_DEFAULT_HEADERS = {
    'Editor-Version': 'vscode/1.95.3',
    'Editor-Plugin-Version': 'copilot-chat/0.22.4',
    'Openai-Intent': 'conversation-panel',
};
/**
 * ChatOpenAICompletions subclass that forwards Gemini's `reasoning_text`
 * delta field (Copilot proxy extension) into `additional_kwargs.reasoning_content`
 * so that `extractDeltas` in langgraph-events.ts can surface it as a thinking delta.
 */
class CopilotCompletionsModel extends ChatOpenAICompletions {
    _convertCompletionsDeltaToBaseMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta, 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawResponse, 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultRole) {
        const chunk = super._convertCompletionsDeltaToBaseMessageChunk(delta, rawResponse, defaultRole);
        const reasoningText = delta?.reasoning_text;
        if (typeof reasoningText === 'string' && reasoningText.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chunk.additional_kwargs = {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(chunk.additional_kwargs ?? {}),
                reasoning_content: reasoningText,
            };
        }
        return chunk;
    }
}
/**
 * Instantiate the LangChain `BaseChatModel` for the currently-configured
 * Yagr provider.  Async because OAuth-account providers (copilot-proxy,
 * openai-oauth) need to exchange a short-lived API token at construction time.
 *
 * @param config Optional explicit overrides (provider, model, apiKey, baseUrl).
 *   When omitted, values are read from the config store / environment.
 * @param configStore Optional config store to read defaults from.
 */
export async function createLangChainModel(config, configStore) {
    const effectiveConfigStore = configStore ?? new YagrConfigService();
    const { provider, model, apiKey, baseUrl } = resolveLanguageModelConfig(config ?? {}, effectiveConfigStore);
    const localConfig = effectiveConfigStore.getLocalConfig();
    switch (provider) {
        case 'anthropic':
            return new ChatAnthropic({ apiKey, model });
        case 'openai':
            return new ChatOpenAI({
                apiKey,
                model,
                ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {}),
            });
        case 'google':
            return new ChatGoogleGenerativeAI({ apiKey, model });
        case 'mistral':
            return new ChatMistralAI({ apiKey, model });
        case 'openrouter':
            return new ChatOpenAI({
                apiKey,
                model,
                configuration: { baseURL: baseUrl ?? 'https://openrouter.ai/api/v1' },
            });
        case 'anthropic-proxy': {
            const session = getAnthropicAccountSession();
            if (!session?.apiKey) {
                throw new Error('Anthropic account session not found. Run `yagr setup` first.');
            }
            return new ChatAnthropic({ apiKey: session.apiKey, model });
        }
        case 'openai-oauth': {
            const session = getOpenAiAccountSession();
            if (!session?.accessToken) {
                throw new Error('OpenAI account session not found. Run `yagr setup` first.');
            }
            return new ChatCodexOAuth({
                model,
                reasoningEffort: localConfig.provider === provider ? localConfig.reasoningEffort : undefined,
            });
        }
        case 'copilot-proxy': {
            const copilotSession = getGitHubCopilotSession();
            if (!copilotSession?.githubToken) {
                throw new Error('GitHub Copilot session not found. Run `yagr setup` first.');
            }
            const runtimeAuth = await resolveCopilotApiToken(copilotSession.githubToken);
            const isGeminiModel = /^gemini/i.test(model);
            const copilotFields = {
                apiKey: runtimeAuth.token,
                model,
                configuration: {
                    baseURL: runtimeAuth.baseUrl,
                    defaultHeaders: COPILOT_DEFAULT_HEADERS,
                },
                // Gemini (via Copilot proxy) only returns reasoning_text when the request
                // includes an explicit thinking_budget.  Without this, Gemini silently
                // omits thinking tokens whenever tools are present in the request.
                // Non-Gemini models (GPT-*) do not support thinking_budget.
                ...(isGeminiModel ? { modelKwargs: { thinking_budget: 1024 } } : {}),
            };
            return new ChatOpenAI({
                ...copilotFields,
                completions: new CopilotCompletionsModel(copilotFields),
            });
        }
        case 'minimax':
        case 'minimax-token-plan':
            return new ChatAnthropic({
                apiKey,
                model,
                anthropicApiUrl: baseUrl ?? 'https://api.minimaxi.com/anthropic',
            });
        case 'openai-compatible':
            return new ChatOpenAI({
                ...(apiKey ? { apiKey } : {}),
                model,
                ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {}),
            });
        default:
            throw new Error(`Unsupported provider for LangChain runtime: ${provider}. Run \`yagr setup\` to configure a supported provider.`);
    }
}
//# sourceMappingURL=create-langchain-model.js.map