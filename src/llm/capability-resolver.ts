import {
  getCachedProviderModelMetadata,
  type YagrProviderModelMetadata,
} from './provider-metadata.js';
import type { YagrModelProvider } from './provider-registry.js';
import {
  CAPABILITY_FLAGS,
  type CapabilityFlags,
  type YagrModelCapabilityProfile,
  type YagrToolCallingCapability,
} from './model-capabilities.js';

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

function normalizeSupportedParameters(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((item) => item.toLowerCase().trim())
    .filter(Boolean);
}

function resolveConservativeSupportedParameters(metadata: YagrProviderModelMetadata): Set<string> {
  const topLevel = new Set(normalizeSupportedParameters(metadata.supportedParameters));

  if (!metadata.endpointVariants?.length) {
    return topLevel;
  }

  let intersection: Set<string> | undefined;
  for (const variant of metadata.endpointVariants) {
    const variantSet = new Set(normalizeSupportedParameters(variant.supportedParameters));
    if (!intersection) {
      intersection = variantSet;
      continue;
    }

    intersection = new Set([...intersection].filter((item) => variantSet.has(item)));
  }

  if (!intersection) {
    return topLevel;
  }

  if (topLevel.size === 0) {
    return intersection;
  }

  return new Set([...intersection].filter((item) => topLevel.has(item)));
}

export function classifyMetadataCapability(
  metadata: YagrProviderModelMetadata,
): YagrToolCallingCapability {
  const supportedParameters = resolveConservativeSupportedParameters(metadata);
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
  // reasoning_effort is present on frontier models (o-series, gpt-5+) that support
  // full native tool calling with parallel calls, structured outputs, and deep reasoning.
  const supportsReasoningEffort = supportedParameters.has('reasoning_effort');

  if (supportsParallel && supportsStructuredOutputs && supportsReasoningEffort) {
    return 'native';
  }

  if (supportsParallel && supportsStructuredOutputs) {
    return 'compatible';
  }

  // Tool calling is supported but without parallel calls or structured outputs.
  return 'compatible';
}

export function classifyOpenRouterMetadataCapability(
  metadata: YagrProviderModelMetadata,
): YagrToolCallingCapability {
  return classifyMetadataCapability(metadata);
}

export function resolveCapabilityProfileFromMetadata(input: {
  provider: YagrModelProvider;
  model: string;
}): YagrModelCapabilityProfile | undefined {
  const metadata = getCachedProviderModelMetadata(input.provider, input.model);
  if (!metadata) {
    return undefined;
  }

  const supportedParameters = resolveConservativeSupportedParameters(metadata);
  // Only classify from metadata when supported_parameters is non-empty.
  // An empty set means the metadata was fetched from a list endpoint without
  // capability detail — it is incomplete, not a declaration of no tool support.
  // Fall back to the provider-level switch in resolveModelCapabilityProfile.
  if (supportedParameters.size === 0 && !metadata.outputModalities?.length) {
    return undefined;
  }

  const toolCalling = classifyMetadataCapability(metadata);
  return buildProfile(input.provider, input.model, toolCalling, {
    supportsParallelToolCalls: toolCalling !== 'none' && supportedParameters.has('parallel_tool_calls'),
    supportsStructuredOutputs: toolCalling !== 'none'
      && (supportedParameters.has('response_format') || supportedParameters.has('structured_outputs')),
    supportsForcedToolChoice: toolCalling !== 'none' && supportedParameters.has('tool_choice'),
  });
}
