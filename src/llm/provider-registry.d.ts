import type { YagrLocalConfig } from '../config/yagr-config-service.js';
export type YagrModelProvider = 'anthropic' | 'openai' | 'google' | 'mistral' | 'openrouter' | 'openai-oauth' | 'anthropic-proxy' | 'copilot-proxy' | 'minimax' | 'minimax-token-plan' | 'openai-compatible';
export interface YagrProviderDefinition {
    id: YagrModelProvider;
    displayName?: string;
    defaultModel: string;
    defaultBaseUrl?: string;
    requiresApiKey: boolean;
    usesOpenAiCompatibleApi: boolean;
    supported?: boolean;
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
        authMode: 'bearer-optional' | 'bearer-required' | 'x-api-key-required' | 'none';
        mapResponse: (data: Record<string, unknown>) => string[];
    };
}
export declare const YAGR_PROVIDER_DEFINITIONS: Record<YagrModelProvider, YagrProviderDefinition>;
export declare const YAGR_MODEL_PROVIDERS: readonly YagrModelProvider[];
export declare const YAGR_SUPPORTED_MODEL_PROVIDERS: readonly YagrModelProvider[];
export declare const YAGR_SELECTABLE_MODEL_PROVIDERS: readonly YagrModelProvider[];
export declare function getProviderDefinition(provider: YagrModelProvider): YagrProviderDefinition;
export declare function getDefaultBaseUrlForProvider(provider: YagrModelProvider): string | undefined;
export declare function getDefaultModelForProvider(provider: YagrModelProvider): string;
export declare function providerNeedsBaseUrlInput(provider: YagrModelProvider): boolean;
export declare function providerRequiresApiKey(provider: YagrModelProvider): boolean;
export declare function isExperimentalProvider(provider: YagrModelProvider): boolean;
export declare function isSupportedProvider(provider: YagrModelProvider): boolean;
export declare function getProviderSetupHint(provider: YagrModelProvider): string | undefined;
export declare function getProviderDisplayName(provider: YagrModelProvider): string;
export declare function isOAuthAccountProvider(provider: YagrModelProvider): boolean;
export declare function normalizeProviderId(provider: string | undefined): YagrModelProvider | undefined;
export declare function isProviderConfigured(localConfig: YagrLocalConfig, getApiKey: (provider: YagrModelProvider) => string | undefined): boolean;
//# sourceMappingURL=provider-registry.d.ts.map