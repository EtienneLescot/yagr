import { getProviderPlugin } from './provider-plugin.js';
export async function fetchAvailableModels(provider, apiKey, baseUrl) {
    const discovery = getProviderPlugin(provider).discovery?.fetchAvailableModels;
    if (!discovery) {
        return [];
    }
    return discovery({ apiKey, baseUrl });
}
//# sourceMappingURL=provider-discovery.js.map