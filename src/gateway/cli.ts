import * as p from '@clack/prompts';
import { YagrAgent } from '../agent.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { runInteractiveGateway } from './interactive-ui.js';
import { resolveLanguageModelConfig, resolveModelName, resolveModelProvider, type YagrModelProvider } from '../llm/create-language-model.js';
import type { YagrRunOptions } from '../types.js';

export interface CliGatewayOptions extends YagrRunOptions {
  prompt?: string;
  interactive?: boolean;
}

/**
 * Ensures a language model provider is available.
 * If setup is incomplete, prompts the user and persists the result.
 */
async function ensureProvider(options: CliGatewayOptions): Promise<YagrModelProvider> {
  const configService = new YagrConfigService();
  const savedConfig = configService.getLocalConfig();

  if (options.provider) {
    return options.provider;
  }

  try {
    const resolved = resolveModelProvider(savedConfig.provider, configService);
    return resolved;
  } catch {
    p.intro('Yagr LLM Setup');
    const selection = await p.select<YagrModelProvider>({
      message: 'No AI provider configured. Select one to finish setup:',
      options: [
        { value: 'openrouter', label: 'OpenRouter', hint: 'Stored by Yagr setup' },
        { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'Stored by Yagr setup' },
        { value: 'openai', label: 'OpenAI (GPT)', hint: 'Stored by Yagr setup' },
        { value: 'google', label: 'Google (Gemini)', hint: 'Stored by Yagr setup' },
        { value: 'groq', label: 'Groq (Llama)', hint: 'Stored by Yagr setup' },
        { value: 'mistral', label: 'Mistral', hint: 'Stored by Yagr setup' },
      ],
    });

    if (p.isCancel(selection)) {
      process.exit(0);
    }

    const providerValue = selection as YagrModelProvider;
    configService.saveLocalConfig({
      ...savedConfig,
      provider: providerValue,
    });

    if (!configService.getApiKey(providerValue)) {
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

      configService.saveApiKey(providerValue, apiKey as string);
      p.log.success(`API key saved for ${providerValue}.`);
    }

    const apiKey = configService.getApiKey(providerValue);
    if (!apiKey) {
      throw new Error(`Missing API key for ${providerValue}. Run yagr setup again.`);
    }

    const models = await fetchAvailableModels(providerValue, apiKey);
    if (models.length > 0) {
      const modelSelection = await p.select({
        message: `Select a model from ${providerValue}:`,
        options: models.map((m) => ({ value: m, label: m })),
      });

      if (p.isCancel(modelSelection)) {
        process.exit(0);
      }

      configService.saveLocalConfig({
        ...configService.getLocalConfig(),
        provider: providerValue,
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

export async function runCliGateway(agent: YagrAgent, options: CliGatewayOptions = {}): Promise<void> {
  const configService = new YagrConfigService();
  const savedConfig = configService.getLocalConfig();

  const provider = await ensureProvider({
    ...options,
    provider: options.provider ?? savedConfig.provider,
  });
  const resolvedConfig = resolveLanguageModelConfig({
    provider,
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  }, configService);

  const effectiveOptions: CliGatewayOptions = {
    ...options,
    provider: resolvedConfig.provider,
    model: resolvedConfig.model,
    apiKey: resolvedConfig.apiKey,
    baseUrl: resolvedConfig.baseUrl,
  };

  configService.saveLocalConfig({
    ...savedConfig,
    provider: provider,
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

function getBaseUrlForProvider(provider: YagrModelProvider): string | undefined {
  switch (provider) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'openai':
      return undefined;
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'mistral':
      return 'https://api.mistral.ai/v1';
    case 'anthropic':
      return undefined;
    default:
      return undefined;
  }
}
