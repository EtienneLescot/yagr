import type { YagrModelProvider } from './provider-registry.js';

export interface YagrProviderTestModelConfig {
  preferredModels: string[];
}

// Test-only model selection policy.
//
// Keep this file easy to scan and edit:
// - one provider per block
// - most preferred model first
// - use provider-registry.ts for product/runtime defaults
export const YAGR_PROVIDER_TEST_MODEL_CONFIG: Partial<Record<YagrModelProvider, YagrProviderTestModelConfig>> = {
  anthropic: {
    preferredModels: [
      'claude-haiku-4-5-20251001',
      'claude-haiku-4-5',
    ],
  },
  openai: {
    preferredModels: [
      'gpt-5-mini',
      'gpt-4.1-mini',
      'gpt-4o-mini',
      'gpt-4o',
    ],
  },
  google: {
    preferredModels: [
      'gemini-3-flash-preview',
      'gemini-3-pro',
    ],
  },
  mistral: {
    preferredModels: [
      'ministral-8b-latest',
      'mistral-small-latest',
      'mistral-large-latest',
    ],
  },
  openrouter: {
    preferredModels: [
      'minimax/minimax-m2.7',
      'openai/gpt-4.1-mini',
      'z-ai/glm-5',
      'z-ai/glm-5-turbo',
      'google/gemini-3-flash-preview',
    ],
  },
  'openai-proxy': {
    preferredModels: [
      'gpt-5.3-codex',
      'gpt-5.1',
    ],
  },
  'anthropic-proxy': {
    preferredModels: [
      'claude-haiku-4-5-20251001',
      'claude-haiku-4-5',
    ],
  },
  'copilot-proxy': {
    preferredModels: [
      'gpt-5.4',
      'gpt-4.1',
    ],
  },
};

export function getProviderTestModelConfig(provider: YagrModelProvider): YagrProviderTestModelConfig | undefined {
  const config = YAGR_PROVIDER_TEST_MODEL_CONFIG[provider];
  return config ? { preferredModels: [...config.preferredModels] } : undefined;
}