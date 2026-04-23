import type { YagrModelProvider } from './provider-registry.js';
export interface YagrProviderModelMetadata {
    provider: YagrModelProvider;
    model: string;
    supportedParameters?: string[];
    supportedEndpoints?: string[];
    inputModalities?: string[];
    outputModalities?: string[];
    contextWindow?: number;
    maxOutputTokens?: number;
    endpointVariants?: Array<{
        providerName?: string;
        providerSlug?: string;
        supportedParameters?: string[];
        contextWindow?: number;
        maxOutputTokens?: number;
    }>;
    fetchedAt: string;
}
export declare function getCachedProviderModelMetadata(provider: YagrModelProvider, model: string): YagrProviderModelMetadata | undefined;
/**
 * Returns the context window size for a model from the static snapshot baseline,
 * falling back to undefined if the model is not in the snapshot.
 * This is a cheap, always-available alternative to the TTL-bound metadata cache.
 */
export declare function getSnapshotContextWindow(provider: YagrModelProvider, model: string): number | undefined;
export declare function clearProviderMetadataCache(): void;
export declare function warmProviderMetadataCacheFromDiscovery(provider: YagrModelProvider, payload: Record<string, unknown>): void;
export declare function fetchAndCacheProviderMetadata(provider: YagrModelProvider, apiKey?: string, baseUrl?: string, options?: {
    model?: string;
}): Promise<YagrProviderModelMetadata[]>;
export declare function primeProviderModelMetadata(provider: YagrModelProvider, model: string, apiKey?: string, baseUrl?: string): Promise<YagrProviderModelMetadata | undefined>;
//# sourceMappingURL=provider-metadata.d.ts.map