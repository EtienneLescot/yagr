import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchAvailableModels } from '../dist/llm/provider-discovery.js';
import {
  clearProviderMetadataCache,
  getCachedProviderModelMetadata,
  primeProviderModelMetadata,
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

test('primeProviderModelMetadata merges openrouter endpoint capabilities into cached model metadata', async () => {
  await withMockedFetch(async (url) => {
    const normalizedUrl = String(url);

    if (normalizedUrl.endsWith('/models')) {
      return new Response(JSON.stringify({
        data: [
          {
            id: 'openai/gpt-5',
            supported_parameters: ['tools'],
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      data: [
        {
          provider_name: 'OpenAI',
          provider_slug: 'openai',
          supported_parameters: ['tool_choice', 'parallel_tool_calls', 'response_format'],
          context_length: 400_000,
          max_completion_tokens: 128_000,
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }, async () => {
    await fetchAvailableModels('openrouter', 'or-key');
    await primeProviderModelMetadata('openrouter', 'openai/gpt-5', 'or-key');

    const metadata = getCachedProviderModelMetadata('openrouter', 'openai/gpt-5');
    assert.ok(metadata);
    assert.deepEqual(metadata.supportedParameters, [
      'tools',
      'tool_choice',
      'parallel_tool_calls',
      'response_format',
    ]);
    assert.equal(metadata.endpointVariants?.length, 1);
    assert.equal(metadata.endpointVariants?.[0]?.providerSlug, 'openai');
  });
});

test('primeProviderModelMetadata falls back to discovery metadata when endpoint metadata is unavailable', async () => {
  await withMockedFetch(async (url) => {
    const normalizedUrl = String(url);

    if (normalizedUrl.endsWith('/models')) {
      return new Response(JSON.stringify({
        data: [
          {
            id: 'cohere/command-a',
            supported_parameters: ['max_tokens', 'temperature'],
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  }, async () => {
    const metadata = await primeProviderModelMetadata('openrouter', 'cohere/command-a', 'or-key');

    assert.ok(metadata);
    assert.deepEqual(metadata.supportedParameters, ['max_tokens', 'temperature']);
    assert.equal(metadata.endpointVariants, undefined);
  });
});
