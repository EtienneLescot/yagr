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

  if (supportsParallel && supportsStructuredOutputs) {
    return 'compatible';
  }

  return 'weak';
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
  const toolCalling = classifyMetadataCapability(metadata);
  return buildProfile(input.provider, input.model, toolCalling, {
    supportsParallelToolCalls: toolCalling !== 'none' && supportedParameters.has('parallel_tool_calls'),
    supportsStructuredOutputs: toolCalling !== 'none'
      && (supportedParameters.has('response_format') || supportedParameters.has('structured_outputs')),
    supportsForcedToolChoice: toolCalling !== 'none' && supportedParameters.has('tool_choice'),
  });
}
