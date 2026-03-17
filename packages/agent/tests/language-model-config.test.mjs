import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveLanguageModelConfig,
  resolveModelName,
  resolveModelProvider,
} from '../dist/llm/create-language-model.js';

function createConfigStore(localConfig = {}, apiKeys = {}) {
  return {
    getLocalConfig() {
      return localConfig;
    },
    getApiKey(provider) {
      return apiKeys[provider];
    },
  };
}

test('resolveModelProvider uses persisted provider from setup', () => {
  const configStore = createConfigStore({ provider: 'openrouter' }, {});

  assert.equal(resolveModelProvider(undefined, configStore), 'openrouter');
});

test('resolveModelProvider falls back to stored credentials when local provider is missing', () => {
  const configStore = createConfigStore({}, { anthropic: 'test-key' });

  assert.equal(resolveModelProvider(undefined, configStore), 'anthropic');
});

test('resolveModelName uses persisted model from setup', () => {
  const configStore = createConfigStore({ provider: 'openrouter', model: 'openai/gpt-5' }, {});

  assert.equal(resolveModelName('openrouter', undefined, configStore), 'openai/gpt-5');
});

test('resolveLanguageModelConfig returns persisted provider model and api key', () => {
  const configStore = createConfigStore(
    { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
    { openrouter: 'or-key' },
  );

  assert.deepEqual(resolveLanguageModelConfig({}, configStore), {
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet',
    apiKey: 'or-key',
    baseUrl: 'https://openrouter.ai/api/v1',
  });
});