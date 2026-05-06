import { getProviderPlugin } from './provider-plugin.js';
import type { YagrModelProvider } from './provider-registry.js';

export async function fetchAvailableModels(
  provider: YagrModelProvider,
  apiKey?: string,
  baseUrl?: string,
): Promise<string[]> {
  const discovery = getProviderPlugin(provider).discovery?.fetchAvailableModels;
  if (!discovery) {
    return [];
  }

  return discovery({ apiKey, baseUrl });
}
