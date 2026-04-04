/**
 * LangChain model factory.
 *
 * Returns a `BaseChatModel` (LangChain) for the configured Yagr provider.
 * Used exclusively by the deep-agent runtime path — the Vercel AI SDK path
 * (`create-language-model.ts`) is retained for the relay proxy and legacy code
 * until those paths are migrated.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatMistralAI } from '@langchain/mistralai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { resolveLanguageModelConfig } from './create-language-model.js';
import { resolveCopilotApiToken, getGitHubCopilotSession } from './copilot-account.js';
import { getOpenAiAccountSession, OPENAI_ACCOUNT_BASE_URL } from './openai-account.js';
import { getAnthropicAccountSession } from './anthropic-account.js';
import type { YagrConfigStoreLike } from '../config/yagr-config-service.js';

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
 * Instantiate the LangChain `BaseChatModel` for the currently-configured
 * Yagr provider.  Async because OAuth-account providers (copilot-proxy,
 * openai-proxy) need to exchange a short-lived API token at construction time.
 */
export async function createLangChainModel(
  configStore?: YagrConfigStoreLike,
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
      return new ChatOpenAI({
        apiKey: runtimeAuth.token,
        model,
        configuration: {
          baseURL: runtimeAuth.baseUrl,
          defaultHeaders: COPILOT_DEFAULT_HEADERS,
        },
      });
    }

    default:
      throw new Error(`Unsupported provider for LangChain runtime: ${provider as string}. Run \`yagr setup\` to configure a supported provider.`);
  }
}
