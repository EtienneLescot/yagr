import {
  getCachedProviderModelMetadata,
  type YagrProviderModelMetadata,
} from './provider-metadata.js';
import type { YagrModelProvider } from './provider-registry.js';
import type { YagrModelCapabilityProfile, YagrToolCallingCapability } from './model-capabilities.js';

type CapabilityFlags = Omit<YagrModelCapabilityProfile, 'provider' | 'model' | 'toolCalling'>;

const CAPABILITY_FLAGS: Record<YagrToolCallingCapability, CapabilityFlags> = {
  native: {
    supportsParallelToolCalls: true,
    supportsStructuredOutputs: true,
    supportsStreamingToolCalls: true,
    supportsForcedToolChoice: true,
    prefersStrictToolSchemas: false,
  },
  compatible: {
    supportsParallelToolCalls: false,
    supportsStructuredOutputs: false,
    supportsStreamingToolCalls: true,
    supportsForcedToolChoice: true,
    prefersStrictToolSchemas: false,
  },
  weak: {
    supportsParallelToolCalls: false,
    supportsStructuredOutputs: false,
    supportsStreamingToolCalls: false,
    supportsForcedToolChoice: false,
    prefersStrictToolSchemas: false,
  },
  none: {
    supportsParallelToolCalls: false,
    supportsStructuredOutputs: false,
    supportsStreamingToolCalls: false,
    supportsForcedToolChoice: false,
    prefersStrictToolSchemas: false,
  },
};

function buildProfile(
  provider: YagrModelProvider,
  model: string,
  toolCalling: YagrToolCallingCapability,
  overrides: Partial<CapabilityFlags> = {},
): YagrModelCapabilityProfile {
  return {
    provider,
    model,
    toolCalling,
    ...CAPABILITY_FLAGS[toolCalling],
    ...overrides,
  };
}

function hasAnyToken(value: string | undefined, patterns: string[]): boolean {
  return Boolean(value && patterns.some((pattern) => value.includes(pattern)));
}

export function classifyOpenRouterMetadataCapability(
  metadata: YagrProviderModelMetadata,
): YagrToolCallingCapability {
  const supportedParameters = new Set((metadata.supportedParameters ?? []).map((item) => item.toLowerCase()));
  const inputModalities = new Set((metadata.inputModalities ?? []).map((item) => item.toLowerCase()));
  const outputModalities = new Set((metadata.outputModalities ?? []).map((item) => item.toLowerCase()));
  const modelId = metadata.model.toLowerCase();

  if (
    outputModalities.has('image')
    || hasAnyToken(modelId, ['embedding', 'embed', 'rerank', 'tts', 'whisper', 'moderation'])
  ) {
    return 'none';
  }

  const supportsTools = supportedParameters.has('tools') || supportedParameters.has('tool_choice');
  if (!supportsTools) {
    return 'none';
  }

  const supportsParallel = supportedParameters.has('parallel_tool_calls');
  const supportsStructuredOutputs = supportedParameters.has('response_format') || supportedParameters.has('structured_outputs');

  if (supportsParallel && supportsStructuredOutputs) {
    return 'compatible';
  }

  return 'weak';
}

export function resolveCapabilityProfileFromMetadata(input: {
  provider: YagrModelProvider;
  model: string;
}): YagrModelCapabilityProfile | undefined {
  const metadata = getCachedProviderModelMetadata(input.provider, input.model);
  if (!metadata) {
    return undefined;
  }

  if (input.provider === 'openrouter') {
    const toolCalling = classifyOpenRouterMetadataCapability(metadata);
    return buildProfile(input.provider, input.model, toolCalling, {
      supportsParallelToolCalls: toolCalling !== 'none' && (metadata.supportedParameters ?? []).includes('parallel_tool_calls'),
      supportsStructuredOutputs: toolCalling !== 'none'
        && ((metadata.supportedParameters ?? []).includes('response_format') || (metadata.supportedParameters ?? []).includes('structured_outputs')),
      supportsForcedToolChoice: toolCalling !== 'none' && (metadata.supportedParameters ?? []).includes('tool_choice'),
    });
  }

  return undefined;
}
