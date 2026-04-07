import type { YagrModelProvider } from './provider-registry.js';
import { getProviderTestModelConfig } from './test-model-config.js';

export function getProviderTestModelPreferences(provider: YagrModelProvider): string[] {
  return getProviderTestModelConfig(provider)?.preferredModels ?? [];
}
