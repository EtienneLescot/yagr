import { getDefaultBaseUrlForProvider, getProviderDefinition, type YagrModelProvider } from './provider-registry.js';

export async function fetchAvailableModels(
  provider: YagrModelProvider,
  apiKey?: string,
  baseUrl?: string,
): Promise<string[]> {
  const definition = getProviderDefinition(provider);
  const discovery = definition.modelDiscovery;
  if (!discovery) {
    return [];
  }

  const discoveryUrl = discovery.buildUrl(baseUrl || getDefaultBaseUrlForProvider(provider));
  if (!discoveryUrl) {
    return [];
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (discovery.authMode !== 'none' && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (discovery.authMode === 'bearer-required' && !apiKey) {
    return [];
  }

  try {
    const response = await fetch(discoveryUrl, { headers });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as Record<string, unknown>;
    return discovery.mapResponse(payload).sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}
