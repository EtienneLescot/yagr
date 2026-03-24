import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterFunctionToolsForCapability,
  getOpenAiCompatibleProviderSettingsForCapability,
  getProviderOptionsForCapability,
  normalizeToolChoiceForCapability,
  resolveModelCapabilityProfile,
} from '../dist/llm/model-capabilities.js';
import {
  classifyOpenRouterMetadataCapability,
  resolveCapabilityProfileFromMetadata,
} from '../dist/llm/capability-resolver.js';
import {
  clearProviderMetadataCache,
  getCachedProviderModelMetadata,
  warmProviderMetadataCacheFromDiscovery,
} from '../dist/llm/provider-metadata.js';

test.afterEach(() => {
  clearProviderMetadataCache();
});

test('resolveModelCapabilityProfile marks direct OpenAI as native', () => {
  const profile = resolveModelCapabilityProfile({
    provider: 'openai',
    model: 'gpt-5.1-codex-mini',
  });

  assert.equal(profile.toolCalling, 'native');
  assert.equal(profile.supportsParallelToolCalls, true);
  assert.equal(profile.supportsStructuredOutputs, true);
  assert.equal(profile.supportsStreamingToolCalls, true);
});

test('resolveModelCapabilityProfile marks openai-proxy as compatible with reduced streaming guarantees', () => {
  const profile = resolveModelCapabilityProfile({
    provider: 'openai-proxy',
    model: 'gpt-5.1-codex-mini',
  });

  assert.equal(profile.toolCalling, 'compatible');
  assert.equal(profile.supportsParallelToolCalls, false);
  assert.equal(profile.supportsStructuredOutputs, false);
  assert.equal(profile.supportsStreamingToolCalls, false);
});

test('resolveModelCapabilityProfile marks anthropic-proxy as native and google-proxy as none', () => {
  const anthropicProfile = resolveModelCapabilityProfile({
    provider: 'anthropic-proxy',
    model: 'claude-sonnet-4-5',
  });
  const googleProxyProfile = resolveModelCapabilityProfile({
    provider: 'google-proxy',
    model: 'gemini-3-flash-preview',
  });

  assert.equal(anthropicProfile.toolCalling, 'native');
  assert.equal(anthropicProfile.supportsStructuredOutputs, true);
  assert.equal(googleProxyProfile.toolCalling, 'none');
  assert.equal(googleProxyProfile.supportsForcedToolChoice, false);
});

test('resolveModelCapabilityProfile can classify weak and none openrouter models', () => {
  const weakProfile = resolveModelCapabilityProfile({
    provider: 'openrouter',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
  });
  const noneProfile = resolveModelCapabilityProfile({
    provider: 'openrouter',
    model: 'openai/text-embedding-3-small',
  });

  assert.equal(weakProfile.toolCalling, 'weak');
  assert.equal(weakProfile.supportsForcedToolChoice, false);
  assert.equal(noneProfile.toolCalling, 'none');
  assert.equal(noneProfile.supportsParallelToolCalls, false);
});

test('openrouter metadata cache warms from discovery payload and resolves a capability profile', () => {
  warmProviderMetadataCacheFromDiscovery('openrouter', {
    data: [
      {
        id: 'google/gemini-2.5-pro',
        context_length: 1_048_576,
        max_completion_tokens: 65_536,
        supported_parameters: ['tools', 'tool_choice', 'parallel_tool_calls', 'response_format'],
        architecture: {
          input_modalities: ['text', 'image'],
          output_modalities: ['text'],
        },
      },
    ],
  });

  const metadata = getCachedProviderModelMetadata('openrouter', 'google/gemini-2.5-pro');
  assert.ok(metadata);
  assert.equal(classifyOpenRouterMetadataCapability(metadata), 'compatible');

  const profile = resolveCapabilityProfileFromMetadata({
    provider: 'openrouter',
    model: 'google/gemini-2.5-pro',
  });

  assert.ok(profile);
  assert.equal(profile.toolCalling, 'compatible');
  assert.equal(profile.supportsParallelToolCalls, true);
  assert.equal(profile.supportsStructuredOutputs, true);
  assert.equal(profile.supportsForcedToolChoice, true);
});

test('resolveModelCapabilityProfile prefers cached metadata over openrouter name heuristics', () => {
  warmProviderMetadataCacheFromDiscovery('openrouter', {
    data: [
      {
        id: 'openai/gpt-5',
        context_length: 400_000,
        max_completion_tokens: 128_000,
        supported_parameters: ['temperature'],
        architecture: {
          input_modalities: ['text'],
          output_modalities: ['text'],
        },
      },
    ],
  });

  const profile = resolveModelCapabilityProfile({
    provider: 'openrouter',
    model: 'openai/gpt-5',
  });

  assert.equal(profile.toolCalling, 'none');
  assert.equal(profile.supportsForcedToolChoice, false);
});

test('capability helpers derive runtime settings from the profile', () => {
  const profile = resolveModelCapabilityProfile({
    provider: 'mistral',
    model: 'mistral-large-latest',
  });

  assert.deepEqual(getProviderOptionsForCapability(profile), {
    openai: { strictSchemas: false },
  });
  assert.deepEqual(getOpenAiCompatibleProviderSettingsForCapability(profile), {
    parallelToolCalls: false,
    structuredOutputs: false,
    simulateStreaming: true,
  });
});

test('capability helpers normalize tool exposure and forced choices', () => {
  const compatibleProfile = resolveModelCapabilityProfile({
    provider: 'openai-proxy',
    model: 'gpt-5.1-codex-mini',
  });
  const noneProfile = resolveModelCapabilityProfile({
    provider: 'google-proxy',
    model: 'gemini-3-flash-preview',
  });

  const tools = [
    { type: 'function', name: 'first', parameters: { type: 'object', properties: {} } },
    { type: 'function', name: 'second', parameters: { type: 'object', properties: {} } },
  ];

  assert.deepEqual(
    filterFunctionToolsForCapability(tools, compatibleProfile).map((tool) => tool.name),
    ['first', 'second'],
  );
  assert.equal(filterFunctionToolsForCapability(tools, noneProfile).length, 0);
  assert.deepEqual(
    normalizeToolChoiceForCapability({ type: 'tool', toolName: 'first' }, noneProfile),
    { type: 'auto' },
  );
});
