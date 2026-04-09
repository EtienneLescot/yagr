import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveLanguageModelConfig,
  resolveModelName,
  resolveModelProvider,
} from '../dist/llm/create-langchain-model.js';

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

async function withEnv(overrides, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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

test('resolveLanguageModelConfig prefers stored credentials over ambient env by default', async () => {
  const configStore = createConfigStore(
    { provider: 'openai', model: 'gpt-5.4' },
    { openai: 'stored-openai-key' },
  );

  await withEnv({ OPENAI_API_KEY: 'lm-studio', YAGR_PREFER_ENV_CREDENTIALS: undefined }, async () => {
    assert.deepEqual(resolveLanguageModelConfig({}, configStore), {
      provider: 'openai',
      model: 'gpt-5.4',
      apiKey: 'stored-openai-key',
      baseUrl: undefined,
    });
  });
});

test('resolveLanguageModelConfig supports proxy providers without api keys', () => {
  const configStore = createConfigStore(
    { provider: 'anthropic-proxy', model: 'claude-haiku-4-5' },
    {},
  );

  assert.deepEqual(resolveLanguageModelConfig({}, configStore), {
    provider: 'anthropic-proxy',
    model: 'claude-haiku-4-5',
    apiKey: undefined,
    baseUrl: undefined,
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

test('resolveLanguageModelConfig supports GitHub Copilot OAuth provider without api key', () => {
  const configStore = createConfigStore(
    { provider: 'copilot-proxy', model: 'gpt-4.1' },
    {},
  );

  assert.deepEqual(resolveLanguageModelConfig({}, configStore), {
    provider: 'copilot-proxy',
    model: 'gpt-4.1',
    apiKey: undefined,
    baseUrl: 'https://api.individual.githubcopilot.com',
  });
});

test('resolveLanguageModelConfig prefers env credentials in env-first mode', async () => {
  const configStore = createConfigStore(
    { provider: 'anthropic', model: 'claude-haiku-4-5' },
    { anthropic: 'stored-key' },
  );

  await withEnv({ YAGR_PREFER_ENV_CREDENTIALS: '1', ANTHROPIC_API_KEY: 'env-key' }, async () => {
    assert.deepEqual(resolveLanguageModelConfig({}, configStore), {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      apiKey: 'env-key',
      baseUrl: undefined,
    });
  });
});

test('resolveLanguageModelConfig skips stored credentials when env-first mode has no env key', async () => {
  const configStore = createConfigStore(
    { provider: 'anthropic', model: 'claude-haiku-4-5' },
    { anthropic: 'stored-key' },
  );

  await withEnv({ YAGR_PREFER_ENV_CREDENTIALS: '1', ANTHROPIC_API_KEY: undefined }, async () => {
    assert.deepEqual(resolveLanguageModelConfig({}, configStore), {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      apiKey: undefined,
      baseUrl: undefined,
    });
  });
});
