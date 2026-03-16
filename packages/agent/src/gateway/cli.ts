import * as p from '@clack/prompts';
import { HolonAgent } from '../agent.js';
import { HolonConfigService } from '../config/holon-config-service.js';
import { runInteractiveGateway } from './interactive-ui.js';
import { resolveModelProvider } from '../llm/create-language-model.js';
import type { HolonRunOptions } from '../types.js';

export interface CliGatewayOptions extends HolonRunOptions {
  prompt?: string;
  interactive?: boolean;
}

/**
 * Ensures a language model provider is available.
 * If not provided in options and not found in env, prompts the user.
 */
async function ensureProvider(options: CliGatewayOptions): Promise<string> {
  const configService = new HolonConfigService();
  const savedConfig = configService.getLocalConfig();

  // If explicitly provided in options, use it
  if (options.provider) return options.provider;

  if (savedConfig.provider) {
    return savedConfig.provider;
  }

  // Try to resolve from environment or auto-detection
  try {
    const resolved = resolveModelProvider();
    return resolved;
  } catch (e) {
    // If resolution fails (no keys found), prompt the user
    p.intro('Holon LLM Setup');
    const selection = await p.select({
      message: 'No AI provider detected. Please select one:',
      options: [
        { value: 'openrouter', label: 'OpenRouter', hint: 'Requires OPENROUTER_API_KEY' },
        { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'Requires ANTHROPIC_API_KEY' },
        { value: 'openai', label: 'OpenAI (GPT)', hint: 'Requires OPENAI_API_KEY' },
        { value: 'google', label: 'Google (Gemini)', hint: 'Requires GOOGLE_GENERATIVE_AI_API_KEY' },
        { value: 'groq', label: 'Groq (Llama)', hint: 'Requires GROQ_API_KEY' },
        { value: 'mistral', label: 'Mistral', hint: 'Requires MISTRAL_API_KEY' },
      ],
    });

    if (p.isCancel(selection)) {
      process.exit(0);
    }

    const providerValue = selection as string;
    process.env.HOLON_MODEL_PROVIDER = providerValue;
    configService.saveLocalConfig({
      ...savedConfig,
      provider: providerValue as any,
    });

    // Ask for API Key if not present in environment
    const envKeyName = getEnvKeyName(providerValue);
    if (!process.env[envKeyName] && !configService.getApiKey(providerValue as any)) {
      const apiKey = await p.password({
        message: `Enter your API key for ${providerValue}:`,
        validate: (value) => {
          if (!value) return 'API key is required';
          if (value.length < 5) return 'API key is too short';
          return;
        },
      });

      if (p.isCancel(apiKey)) {
        process.exit(0);
      }

      // Set it in process.env so createLanguageModel can find it
      process.env[envKeyName] = apiKey as string;
      configService.saveApiKey(providerValue as any, apiKey as string);
      p.log.success(`${envKeyName} set for this session.`);
    }

    if (!process.env[envKeyName]) {
      const persistedApiKey = configService.getApiKey(providerValue as any);
      if (persistedApiKey) {
        process.env[envKeyName] = persistedApiKey;
      }
    }

    // Fetch models if provider supports it
    const apiKey = process.env[envKeyName]!;
    const models = await fetchAvailableModels(providerValue, apiKey);
    if (models.length > 0) {
      const modelSelection = await p.select({
        message: `Select a model from ${providerValue}:`,
        options: models.map((m) => ({ value: m, label: m })),
      });

      if (p.isCancel(modelSelection)) {
        process.exit(0);
      }

      process.env.HOLON_MODEL = modelSelection as string;
      configService.saveLocalConfig({
        ...configService.getLocalConfig(),
        provider: providerValue as any,
        model: modelSelection as string,
        baseUrl: getBaseUrlForProvider(providerValue),
      });
      p.log.success(`Model set to ${modelSelection}`);
    }

    return providerValue;
  }
}

async function fetchAvailableModels(provider: string, apiKey: string): Promise<string[]> {
  try {
    const s = p.spinner();
    s.start(`Fetching available models for ${provider}...`);

    let url = '';
    let mapFn = (data: any): string[] => [];
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (provider === 'openrouter') {
      url = 'https://openrouter.ai/api/v1/models';
      headers['Authorization'] = `Bearer ${apiKey}`;
      mapFn = (data) => data.data?.map((m: any) => m.id) || [];
    } else if (provider === 'openai') {
      url = 'https://api.openai.com/v1/models';
      headers['Authorization'] = `Bearer ${apiKey}`;
      mapFn = (data) => (data.data as any[])?.filter((m: any) => m.id.startsWith('gpt') || m.id.startsWith('o1')).map((m: any) => m.id) || [];
    } else if (provider === 'groq') {
      url = 'https://api.groq.com/openai/v1/models';
      headers['Authorization'] = `Bearer ${apiKey}`;
      mapFn = (data) => data.data?.map((m: any) => m.id) || [];
    } else if (provider === 'mistral') {
      url = 'https://api.mistral.ai/v1/models';
      headers['Authorization'] = `Bearer ${apiKey}`;
      mapFn = (data) => data.data?.map((m: any) => m.id) || [];
    } else {
      s.stop('Model fetching not yet implemented for this provider.');
      return [];
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json();
    const models = mapFn(data);
    const sortedModels = models.sort((a, b) => a.localeCompare(b));
    s.stop(`Found ${sortedModels.length} models.`);
    return sortedModels;
  } catch (error) {
    p.log.warn(`Could not fetch models: ${(error as Error).message}. Using default.`);
    return [];
  }
}

function getEnvKeyName(provider: string): string {
  switch (provider) {
    case 'openrouter': return 'OPENROUTER_API_KEY';
    case 'anthropic': return 'ANTHROPIC_API_KEY';
    case 'openai': return 'OPENAI_API_KEY';
    case 'google': return 'GOOGLE_GENERATIVE_AI_API_KEY';
    case 'groq': return 'GROQ_API_KEY';
    case 'mistral': return 'MISTRAL_API_KEY';
    default: return 'AI_API_KEY';
  }
}

export async function runCliGateway(agent: HolonAgent, options: CliGatewayOptions = {}): Promise<void> {
  const configService = new HolonConfigService();
  const savedConfig = configService.getLocalConfig();

  // Ensure we have a provider before starting
  const provider = await ensureProvider({
    ...options,
    provider: options.provider ?? savedConfig.provider,
  });
  const providerApiKey = process.env[getEnvKeyName(provider)];

  if (!process.env[getEnvKeyName(provider)]) {
    const persistedApiKey = configService.getApiKey(provider as any);
    if (persistedApiKey) {
      process.env[getEnvKeyName(provider)] = persistedApiKey;
    }
  }

  if (!process.env.HOLON_MODEL && savedConfig.model) {
    process.env.HOLON_MODEL = savedConfig.model;
  }
  
  // Update options with the resolved provider and potentially the model/key from env
  const effectiveOptions: CliGatewayOptions = { 
    ...options, 
    provider: provider as any,
    model: process.env.HOLON_MODEL || options.model || savedConfig.model,
    apiKey: process.env[getEnvKeyName(provider)] || providerApiKey || options.apiKey,
    baseUrl: options.baseUrl || savedConfig.baseUrl || getBaseUrlForProvider(provider),
  };

  configService.saveLocalConfig({
    ...savedConfig,
    provider: provider as any,
    model: effectiveOptions.model,
    baseUrl: effectiveOptions.baseUrl,
  });

  if (options.prompt && !options.interactive) {
    const result = await agent.run(options.prompt, effectiveOptions);
    process.stdout.write(`${result.text}\n`);
    return;
  }

  await runInteractiveGateway(agent, effectiveOptions);
  return;
}

function getBaseUrlForProvider(provider: string): string | undefined {
  switch (provider) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'openai':
      return process.env.OPENAI_BASE_URL;
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'mistral':
      return 'https://api.mistral.ai/v1';
    case 'anthropic':
      return process.env.ANTHROPIC_BASE_URL;
    default:
      return undefined;
  }
}
