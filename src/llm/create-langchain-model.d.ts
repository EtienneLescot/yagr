import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
export type { YagrModelProvider } from './provider-registry.js';
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
export declare function resolveModelProvider(explicitProvider?: string, configStore?: YagrLanguageModelConfigStore): import('./provider-registry.js').YagrModelProvider;
export declare function resolveModelName(provider: import('./provider-registry.js').YagrModelProvider, explicitModel?: string, configStore?: YagrLanguageModelConfigStore): string;
export declare function resolveLanguageModelConfig(config?: YagrLanguageModelConfig, configStore?: YagrLanguageModelConfigStore): ResolvedYagrLanguageModelConfig;
/**
 * Instantiate the LangChain `BaseChatModel` for the currently-configured
 * Yagr provider.  Async because OAuth-account providers (copilot-proxy,
 * openai-oauth) need to exchange a short-lived API token at construction time.
 *
 * @param config Optional explicit overrides (provider, model, apiKey, baseUrl).
 *   When omitted, values are read from the config store / environment.
 * @param configStore Optional config store to read defaults from.
 */
export declare function createLangChainModel(config?: YagrLanguageModelConfig, configStore?: YagrLanguageModelConfigStore): Promise<BaseChatModel>;
//# sourceMappingURL=create-langchain-model.d.ts.map