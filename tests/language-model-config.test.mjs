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

test('resolveLanguageModelConfig supports proxy providers without api keys', () => {
  const configStore = createConfigStore(
    { provider: 'anthropic-proxy', model: 'claude-sonnet-4', baseUrl: 'http://127.0.0.1:3456/v1' },
    {},
  );

  assert.deepEqual(resolveLanguageModelConfig({}, configStore), {
    provider: 'anthropic-proxy',
    model: 'claude-sonnet-4',
    apiKey: undefined,
    baseUrl: 'http://127.0.0.1:3456/v1',
  });
});

test('resolveLanguageModelConfig supports OpenAI account-backed provider without api key', () => {
  const configStore = createConfigStore(
    { provider: 'openai-proxy', model: 'gpt-5.4' },
    {},
  );

  assert.deepEqual(resolveLanguageModelConfig({}, configStore), {
    provider: 'openai-proxy',
    model: 'gpt-5.4',
    apiKey: undefined,
    baseUrl: 'https://chatgpt.com/backend-api',
  });
});
