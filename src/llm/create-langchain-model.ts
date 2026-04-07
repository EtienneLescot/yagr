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
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessageChunk } from '@langchain/core/messages';
import { YagrConfigService, type YagrConfigStoreLike } from '../config/yagr-config-service.js';
import {
  getDefaultBaseUrlForProvider,
  getDefaultModelForProvider,
  YAGR_MODEL_PROVIDERS,
} from './provider-registry.js';
export type { YagrModelProvider } from './provider-registry.js';
import { resolveCopilotApiToken, getGitHubCopilotSession } from './copilot-account.js';
import { getOpenAiAccountSession, OPENAI_ACCOUNT_BASE_URL } from './openai-account.js';
import { getAnthropicAccountSession } from './anthropic-account.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface YagrLanguageModelConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ResolvedYagrLanguageModelConfig {
  provider: import('./provider-registry.js').YagrModelProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

interface YagrLanguageModelConfigStore {
  getLocalConfig(): import('../config/yagr-config-service.js').YagrLocalConfig;
  getApiKey(provider: import('./provider-registry.js').YagrModelProvider): string | undefined;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const KNOWN_MODEL_PROVIDERS = [...YAGR_MODEL_PROVIDERS];

// ─── Resolution utilities ─────────────────────────────────────────────────────

function preferEnvironmentCredentials(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.YAGR_PREFER_ENV_CREDENTIALS || '').trim());
}

function getApiKeyForProvider(
  provider: import('./provider-registry.js').YagrModelProvider,
  configStore: YagrLanguageModelConfigStore,
): string | undefined {
  const byProvider: Partial<Record<import('./provider-registry.js').YagrModelProvider, string[]>> = {
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

  return configStore.getApiKey(provider) ?? undefined;
}

function getBaseUrlForProvider(
  provider: import('./provider-registry.js').YagrModelProvider,
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

export function resolveModelProvider(
  explicitProvider?: string,
  configStore: YagrLanguageModelConfigStore = new YagrConfigService(),
): import('./provider-registry.js').YagrModelProvider {
  if (explicitProvider) {
    return explicitProvider as import('./provider-registry.js').YagrModelProvider;
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
  provider: import('./provider-registry.js').YagrModelProvider,
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
  protected override _convertCompletionsDeltaToBaseMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta: Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawResponse: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultRole?: any,
  ): BaseMessageChunk {
    const chunk = super._convertCompletionsDeltaToBaseMessageChunk(delta, rawResponse, defaultRole);
    const reasoningText = delta?.reasoning_text;
    if (typeof reasoningText === 'string' && reasoningText.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chunk as any).additional_kwargs = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...((chunk as any).additional_kwargs ?? {}),
        reasoning_content: reasoningText,
      };
    }
    return chunk;
  }
}

/**
 * Instantiate the LangChain `BaseChatModel` for the currently-configured
 * Yagr provider.  Async because OAuth-account providers (copilot-proxy,
 * openai-proxy) need to exchange a short-lived API token at construction time.
 */
export async function createLangChainModel(
  configStore?: YagrLanguageModelConfigStore,
): Promise<BaseChatModel> {
  const { provider, model, apiKey, baseUrl } = resolveLanguageModelConfig({}, configStore);

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
      return new ChatGoogleGenerativeAI({ apiKey, model } as ConstructorParameters<typeof ChatGoogleGenerativeAI>[0]);

    case 'mistral':
      return new ChatMistralAI({ apiKey, model } as ConstructorParameters<typeof ChatMistralAI>[0]);

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

    case 'openai-proxy': {
      const session = getOpenAiAccountSession();
      if (!session?.accessToken) {
        throw new Error('OpenAI account session not found. Run `yagr setup` first.');
      }
      return new ChatOpenAI({
        apiKey: session.accessToken,
        model,
        configuration: { baseURL: OPENAI_ACCOUNT_BASE_URL },
      });
    }

    case 'copilot-proxy': {
      const copilotSession = getGitHubCopilotSession();
      if (!copilotSession?.githubToken) {
        throw new Error('GitHub Copilot session not found. Run `yagr setup` first.');
      }
      const runtimeAuth = await resolveCopilotApiToken(copilotSession.githubToken);
      const copilotFields = {
        apiKey: runtimeAuth.token,
        model,
        configuration: {
          baseURL: runtimeAuth.baseUrl,
          defaultHeaders: COPILOT_DEFAULT_HEADERS,
        },
        // Gemini (via Copilot proxy) only returns reasoning_text when the request
        // includes an explicit thinking_budget.  Without this, Gemini silently
        // omits thinking tokens whenever tools are present in the request —
        // which is the case for every agentic turn.
        modelKwargs: { thinking_budget: 1024 },
      };
      return new ChatOpenAI({
        ...copilotFields,
        completions: new CopilotCompletionsModel(copilotFields),
      });
    }

    default:
      throw new Error(`Unsupported provider for LangChain runtime: ${provider as string}. Run \`yagr setup\` to configure a supported provider.`);
  }
}
