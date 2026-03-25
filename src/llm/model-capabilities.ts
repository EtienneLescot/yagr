import type { LanguageModelV1FunctionTool, LanguageModelV1ToolChoice } from '@ai-sdk/provider';
import { resolveCapabilityProfileFromMetadata } from './capability-resolver.js';
import type { YagrModelProvider } from './provider-registry.js';

export type YagrToolCallingCapability = 'native' | 'compatible' | 'weak' | 'none';

export interface YagrModelCapabilityProfile {
  provider: YagrModelProvider;
  model: string;
  toolCalling: YagrToolCallingCapability;
  supportsParallelToolCalls: boolean;
  supportsStructuredOutputs: boolean;
  supportsStreamingToolCalls: boolean;
  supportsForcedToolChoice: boolean;
  prefersStrictToolSchemas: boolean;
}

export type CapabilityFlags = Omit<YagrModelCapabilityProfile, 'provider' | 'model' | 'toolCalling'>;

export const CAPABILITY_FLAGS: Record<YagrToolCallingCapability, CapabilityFlags> = {
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

function classifyOpenRouterModel(model: string): YagrToolCallingCapability {
  const normalized = model.toLowerCase();

  // Semantic-purpose exclusions: these identifiers describe non-LLM endpoint
  // types (embeddings, rerankers, speech, moderation) that definitionally do
  // not support tool calling. This is not a heuristic — the endpoint type is
  // encoded in the model ID by OpenRouter convention.
  if (
    normalized.includes('embed')
    || normalized.includes('embedding')
    || normalized.includes('rerank')
    || normalized.includes('whisper')
    || normalized.includes('tts')
    || normalized.includes('moderation')
  ) {
    return 'none';
  }

  // When metadata is unavailable, default to compatible: tool calling is sent
  // sequentially without parallel calls or structured outputs. The metadata
  // path (classifyMetadataCapability) provides precise per-model classification
  // whenever primeModelMetadata has been called successfully.
  return 'compatible';
}

export function resolveModelCapabilityProfile(input: {
  provider: YagrModelProvider;
  model: string;
}): YagrModelCapabilityProfile {
  const provider = input.provider;
  const model = String(input.model || '').trim();
  const resolvedFromMetadata = resolveCapabilityProfileFromMetadata({ provider, model });
  if (resolvedFromMetadata) {
    // Apply provider-level constraints that metadata cannot determine.
    // copilot-proxy uses a simulated (non-streaming) completion wrapper, so
    // streaming tool calls are never truly supported regardless of model tier.
    if (provider === 'copilot-proxy') {
      return { ...resolvedFromMetadata, supportsStreamingToolCalls: false };
    }
    return resolvedFromMetadata;
  }

  switch (provider) {
    case 'openai':
    case 'anthropic':
      return buildProfile(provider, model, 'native');
    case 'openai-proxy':
      return buildProfile(provider, model, 'compatible', {
        supportsStreamingToolCalls: false,
      });
    case 'copilot-proxy':
      return buildProfile(provider, model, 'compatible', {
        supportsStructuredOutputs: false,
        supportsStreamingToolCalls: false,
      });
    case 'google':
      return buildProfile(provider, model, 'native');
    case 'mistral':
      // Mistral models support function calling natively (sequential, no
      // parallel calls, no structured outputs). The AI SDK Mistral provider
      // requires simulateStreaming which is forced in provider-plugin.ts,
      // so we keep supportsStreamingToolCalls false here.
      return buildProfile(provider, model, 'compatible', {
        supportsStreamingToolCalls: false,
      });
    case 'openrouter':
      return buildProfile(provider, model, classifyOpenRouterModel(model));
    case 'anthropic-proxy':
      return buildProfile(provider, model, 'native');
    default:
      return buildProfile(provider, model, 'compatible');
  }
}

export function getProviderOptionsForCapability(profile: YagrModelCapabilityProfile): { openai?: { strictSchemas: boolean } } | undefined {
  if (!profile.prefersStrictToolSchemas) {
    return { openai: { strictSchemas: false } };
  }

  return undefined;
}

export function getOpenAiCompatibleProviderSettingsForCapability(
  profile: YagrModelCapabilityProfile,
): {
  parallelToolCalls?: boolean;
  structuredOutputs?: boolean;
  simulateStreaming?: boolean;
} | undefined {
  if (profile.toolCalling === 'none') {
    return {
      simulateStreaming: true,
    };
  }

  if (profile.toolCalling === 'native') {
    return undefined;
  }

  return {
    parallelToolCalls: profile.supportsParallelToolCalls,
    structuredOutputs: profile.supportsStructuredOutputs,
    simulateStreaming: !profile.supportsStreamingToolCalls,
  };
}

export function filterFunctionToolsForCapability(
  tools: LanguageModelV1FunctionTool[],
  profile: YagrModelCapabilityProfile,
): LanguageModelV1FunctionTool[] {
  if (profile.toolCalling === 'none') {
    return [];
  }

  return tools;
}

export function normalizeToolChoiceForCapability(
  toolChoice: LanguageModelV1ToolChoice | undefined,
  profile: YagrModelCapabilityProfile,
): LanguageModelV1ToolChoice | undefined {
  if (!toolChoice) {
    return toolChoice;
  }

  if (!profile.supportsForcedToolChoice && toolChoice.type !== 'auto') {
    return { type: 'auto' };
  }

  if (profile.toolCalling === 'none') {
    return { type: 'auto' };
  }

  return toolChoice;
}
