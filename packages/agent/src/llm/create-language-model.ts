import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

export type HolonModelProvider = 'anthropic' | 'openai' | 'google' | 'groq' | 'mistral' | 'openrouter';

export interface HolonModelContextProfile {
  provider: HolonModelProvider;
  model: string;
  contextWindowTokens: number;
  reservedOutputTokens: number;
}

export interface HolonLanguageModelConfig {
  provider?: HolonModelProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';
const DEFAULT_RESERVED_OUTPUT_TOKENS = 8_192;

function inferContextWindowTokens(provider: HolonModelProvider, modelName: string): number {
  const normalized = modelName.toLowerCase();

  if (provider === 'anthropic' || provider === 'openrouter') {
    if (normalized.includes('haiku') || normalized.includes('sonnet') || normalized.includes('opus') || normalized.includes('claude')) {
      return 200_000;
    }
  }

  if (provider === 'openai') {
    if (normalized.startsWith('gpt-5') || normalized.includes('gpt-5')) {
      return 400_000;
    }
    if (normalized.startsWith('o1') || normalized.startsWith('o3')) {
      return 200_000;
    }
    return 128_000;
  }

  if (provider === 'google') {
    return 1_000_000;
  }

  if (provider === 'groq' || provider === 'mistral') {
    return 128_000;
  }

  return 128_000;
}

export function resolveModelContextProfile(config: HolonLanguageModelConfig = {}): HolonModelContextProfile {
  const provider = resolveModelProvider(config.provider);
  const model = resolveModelName(provider, config.model);

  return {
    provider,
    model,
    contextWindowTokens: inferContextWindowTokens(provider, model),
    reservedOutputTokens: DEFAULT_RESERVED_OUTPUT_TOKENS,
  };
}

export function resolveModelProvider(explicitProvider?: string): HolonModelProvider {
  if (explicitProvider) {
    return explicitProvider as HolonModelProvider;
  }

  // Priority order for provider resolution
  if (process.env.HOLON_MODEL_PROVIDER) {
    return process.env.HOLON_MODEL_PROVIDER as HolonModelProvider;
  }

  // Auto-detect based on valid-looking keys (ignore 'lm-studio' or empty strings)
  const isOk = (keyName: string) => {
    const val = process.env[keyName];
    return val && val.trim() !== '' && val !== 'lm-studio';
  };

  if (isOk('OPENROUTER_API_KEY')) return 'openrouter';
  if (isOk('ANTHROPIC_API_KEY')) return 'anthropic';
  if (isOk('OPENAI_API_KEY')) return 'openai';
  if (isOk('GOOGLE_GENERATIVE_AI_API_KEY')) return 'google';
  if (isOk('GROQ_API_KEY')) return 'groq';
  if (isOk('MISTRAL_API_KEY')) return 'mistral';

  throw new Error('No valid AI provider detected');
}

export function resolveModelName(
  provider: HolonModelProvider,
  explicitModel?: string,
): string {
  if (explicitModel) {
    return explicitModel;
  }

  const fromEnv = process.env.HOLON_MODEL;
  if (fromEnv) return fromEnv;

  switch (provider) {
    case 'openrouter': return DEFAULT_OPENROUTER_MODEL;
    case 'anthropic': return DEFAULT_ANTHROPIC_MODEL;
    case 'openai': return DEFAULT_OPENAI_MODEL;
    case 'google': return 'gemini-1.5-pro-latest';
    case 'groq': return 'llama-3.1-70b-versatile';
    case 'mistral': return 'mistral-large-latest';
    default: return DEFAULT_OPENAI_MODEL;
  }
}

export function createLanguageModel(config: HolonLanguageModelConfig = {}) {
  const provider = resolveModelProvider(config.provider);
  const modelName = resolveModelName(provider, config.model);

  // We allow overriding the API key and Base URL via config or env
  const apiKey = config.apiKey || getApiKeyForProvider(provider);
  const baseURL = config.baseUrl || getBaseUrlForProvider(provider);
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;

  if (provider === 'openrouter') {
    return createOpenAI({
      apiKey: apiKey || process.env.OPENROUTER_API_KEY,
      baseURL: baseURL || 'https://openrouter.ai/api/v1',
      headers,
      name: 'openrouter',
      compatibility: 'compatible',
    })(modelName);
  }

  if (provider === 'anthropic') {
    return createAnthropic({
      apiKey,
      baseURL,
    })(modelName);
  }

  // Default to OpenAI-compatible for others if possible, or specialized providers
  if (provider === 'openai' || provider === 'groq' || provider === 'mistral') {
    return createOpenAI({
      apiKey,
      baseURL,
      headers,
      name: provider,
      compatibility: 'compatible',
    })(modelName);
  }

  throw new Error(`Provider ${provider} is not yet fully implemented in createLanguageModel`);
}

function getApiKeyForProvider(provider: HolonModelProvider): string | undefined {
  switch (provider) {
    case 'openrouter': return process.env.OPENROUTER_API_KEY;
    case 'anthropic': return process.env.ANTHROPIC_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'google': return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    case 'groq': return process.env.GROQ_API_KEY;
    case 'mistral': return process.env.MISTRAL_API_KEY;
    default: return undefined;
  }
}

function getBaseUrlForProvider(provider: HolonModelProvider): string | undefined {
  switch (provider) {
    case 'openai': return process.env.OPENAI_BASE_URL;
    case 'anthropic': return process.env.ANTHROPIC_BASE_URL;
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'mistral': return 'https://api.mistral.ai/v1';
    default: return undefined;
  }
}
