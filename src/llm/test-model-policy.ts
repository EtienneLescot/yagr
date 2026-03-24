import type { YagrModelProvider } from './provider-registry.js';

const TEST_MODEL_PREFERENCES: Partial<Record<YagrModelProvider, string[]>> = {
  openai: ['gpt-4.1-mini', 'gpt-5-mini', 'gpt-4o-mini', 'gpt-4o'],
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5'],
  google: ['gemini-3-flash-preview', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  mistral: ['ministral-8b-latest', 'mistral-small-latest', 'mistral-large-latest'],
  openrouter: ['z-ai/glm-5-turbo', 'google/gemini-3-flash-preview', 'openai/gpt-4.1-mini'],
  'openai-proxy': ['gpt-5.3-codex', 'gpt-5.1'],
  'anthropic-proxy': ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5'],
  'copilot-proxy': ['gpt-5.4', 'gpt-4.1'],
};

export function getProviderTestModelPreferences(provider: YagrModelProvider): string[] {
  return [...(TEST_MODEL_PREFERENCES[provider] ?? [])];
}
