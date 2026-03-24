import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchAvailableModels } from '../dist/llm/provider-discovery.js';
import {
  clearProviderMetadataCache,
  getCachedProviderModelMetadata,
} from '../dist/llm/provider-metadata.js';

async function withMockedFetch(mockedFetch, run) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockedFetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test.afterEach(() => {
  clearProviderMetadataCache();
});

test('fetchAvailableModels warms openrouter metadata cache from discovery payload', async () => {
  await withMockedFetch(async () => new Response(JSON.stringify({
    data: [
      {
        id: 'openai/gpt-5',
        context_length: 400_000,
        max_completion_tokens: 128_000,
        supported_parameters: ['tools', 'tool_choice', 'parallel_tool_calls'],
        architecture: {
          input_modalities: ['text'],
          output_modalities: ['text'],
        },
      },
    ],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }), async () => {
    const models = await fetchAvailableModels('openrouter', 'or-key');

    assert.deepEqual(models, ['openai/gpt-5']);
    assert.deepEqual(
      getCachedProviderModelMetadata('openrouter', 'openai/gpt-5')?.supportedParameters,
      ['tools', 'tool_choice', 'parallel_tool_calls'],
    );
  });
});
