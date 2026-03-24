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

function classifyOpenRouterModel(model: string): YagrToolCallingCapability {
  const normalized = model.toLowerCase();

  if (
    normalized.includes('embed')
    || normalized.includes('embedding')
    || normalized.includes('rerank')
    || normalized.includes('whisper')
    || normalized.includes('tts')
    || normalized.includes('image')
    || normalized.includes('vision')
    || normalized.includes('moderation')
  ) {
    return 'none';
  }

  if (
    normalized.includes(':free')
    || normalized.includes('/free')
    || /\b(7b|8b|11b|12b)\b/.test(normalized)
    || normalized.includes('small')
    || normalized.includes('mini')
  ) {
    return 'weak';
  }

  if (
    normalized.startsWith('openai/')
    || normalized.startsWith('anthropic/')
    || normalized.startsWith('google/')
    || normalized.includes('/claude')
    || normalized.includes('/gpt-4')
    || normalized.includes('/gpt-5')
    || normalized.includes('/gemini')
  ) {
    return 'compatible';
  }

  return 'weak';
}

export function resolveModelCapabilityProfile(input: {
  provider: YagrModelProvider;
  model: string;
}): YagrModelCapabilityProfile {
  const provider = input.provider;
  const model = String(input.model || '').trim();
  const resolvedFromMetadata = resolveCapabilityProfileFromMetadata({ provider, model });
  if (resolvedFromMetadata) {
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
      return buildProfile(provider, model, 'compatible');
    case 'google-proxy':
      return buildProfile(provider, model, 'weak', {
        supportsStructuredOutputs: true,
        supportsForcedToolChoice: true,
      });
    case 'groq':
      return buildProfile(provider, model, 'compatible');
    case 'mistral':
      return buildProfile(provider, model, 'weak');
    case 'openrouter':
      return buildProfile(provider, model, classifyOpenRouterModel(model));
    case 'anthropic-proxy':
      return buildProfile(provider, model, 'native');
    default:
      return buildProfile(provider, model, 'weak');
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
