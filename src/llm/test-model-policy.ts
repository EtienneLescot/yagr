import type { YagrModelProvider } from './provider-registry.js';

const TEST_MODEL_PREFERENCES: Partial<Record<YagrModelProvider, string[]>> = {
  openai: ['gpt-4.1-mini', 'gpt-5-mini', 'gpt-4o-mini', 'gpt-4o'],
  anthropic: ['claude-3-haiku-20240307', 'claude-sonnet-4-5'],
  google: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'],
  groq: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'allam-2-7b'],
  mistral: ['ministral-8b-latest', 'mistral-small-latest', 'mistral-large-latest'],
  openrouter: ['google/gemini-3-flash-preview', 'openai/gpt-4.1-mini', 'openai/gpt-4o-mini'],
  'openai-proxy': ['gpt-5.1-codex-mini', 'gpt-5.1'],
  'anthropic-proxy': ['claude-3-haiku-20240307', 'claude-sonnet-4-5'],
  'google-proxy': ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  'copilot-proxy': ['gpt-4.1'],
};

export function getProviderTestModelPreferences(provider: YagrModelProvider): string[] {
  return [...(TEST_MODEL_PREFERENCES[provider] ?? [])];
}
