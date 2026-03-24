import { YagrSessionAgent } from '../agent.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { runInteractiveGateway } from './interactive-ui.js';
import { resolveLanguageModelConfig, resolveModelProvider, type YagrModelProvider } from '../llm/create-language-model.js';
import { YagrSetupApplicationService } from '../setup/application-services.js';
import type { YagrRunOptions } from '../types.js';

export interface CliGatewayOptions extends YagrRunOptions {
  prompt?: string;
  interactive?: boolean;
}

async function ensureProvider(options: CliGatewayOptions): Promise<YagrModelProvider> {
  const configService = new YagrConfigService();
  const savedConfig = configService.getLocalConfig();

  if (options.provider) {
    return options.provider;
  }

  try {
    return resolveModelProvider(savedConfig.provider, configService);
  } catch {
    throw new Error('No LLM provider configured. Run `yagr setup` first.');
  }
}

export async function runCliGateway(agent: YagrSessionAgent, options: CliGatewayOptions = {}): Promise<void> {
  const configService = new YagrConfigService();
  const setupService = new YagrSetupApplicationService(configService, new YagrN8nConfigService());
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

  setupService.saveResolvedCliModelSelection({
    provider,
    model: resolvedConfig.model,
    baseUrl: effectiveOptions.baseUrl,
    apiKey: effectiveOptions.apiKey,
  });

  if (options.prompt && !options.interactive) {
    const result = await agent.run(options.prompt, effectiveOptions);
    process.stdout.write(`${result.text}\n`);
    return;
  }

  await runInteractiveGateway(agent, effectiveOptions);
}
