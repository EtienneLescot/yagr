import { type YagrModelProvider, type YagrProviderDefinition } from './provider-registry.js';
export interface YagrProviderTransportContract {
    usesOpenAiCompatibleApi: boolean;
    managedProxy: boolean;
    oauthAccount: boolean;
}
export interface YagrProviderMetadataContract {
    warmDiscoveryPayload?: (payload: Record<string, unknown>) => void;
    primeModelMetadata?: (args: {
        model: string;
        apiKey?: string;
        baseUrl?: string;
    }) => Promise<void>;
}
export interface YagrProviderDiscoveryContract {
    fetchAvailableModels?: (args: {
        apiKey?: string;
        baseUrl?: string;
    }) => Promise<string[]>;
}
export interface YagrProviderPlugin {
    id: YagrModelProvider;
    definition: YagrProviderDefinition;
    transport: YagrProviderTransportContract;
    discovery?: YagrProviderDiscoveryContract;
    metadata?: YagrProviderMetadataContract;
}
export declare function getProviderPlugin(provider: YagrModelProvider): YagrProviderPlugin;
//# sourceMappingURL=provider-plugin.d.ts.map