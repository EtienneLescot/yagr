#!/usr/bin/env node
import './config/init-yagr-home.js';
import { createN8nEngineFromWorkspace } from './config/load-n8n-engine-config.js';
import { YagrConfigService } from './config/yagr-config-service.js';
import { getGatewaySupervisorStatus, runGatewaySupervisor } from './gateway/manager.js';
import {
  getTelegramGatewayStatus,
  resetTelegramGateway,
  runTelegramGateway,
  showTelegramOnboarding,
  setupTelegramGateway,
} from './gateway/telegram.js';
import { YagrAgent } from './agent.js';
import type { YagrModelProvider } from './llm/create-language-model.js';
import { getYagrSetupStatus, runYagrSetup } from './setup.js';

const VALID_PROVIDERS: YagrModelProvider[] = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'mistral',
  'openrouter',
];

interface ParsedArgs {
  command?: 'config-show' | 'config-reset' | 'setup' | 'start' | 'gateway-start' | 'gateway-status' | 'telegram-setup' | 'telegram-start' | 'telegram-status' | 'telegram-reset' | 'telegram-onboarding';
  prompt?: string;
  interactive: boolean;
  provider?: YagrModelProvider;
  model?: string;
  maxSteps?: number;
  showThinking: boolean;
  showExecution: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    interactive: false,
    showThinking: true,
    showExecution: true,
  };

  let startIndex = 0;

  if (argv[0] === 'config' && argv[1] === 'show') {
    parsed.command = 'config-show';
    return parsed;
  }

  if (argv[0] === 'config' && argv[1] === 'reset') {
    parsed.command = 'config-reset';
    return parsed;
  }

  if (argv[0] === 'setup' || argv[0] === 'onboard') {
    parsed.command = 'setup';
    startIndex = 1;
  }

  if (argv[0] === 'start') {
    parsed.command = 'start';
    startIndex = 1;
  }

  if (argv[0] === 'gateway' && argv[1] === 'start') {
    parsed.command = 'gateway-start';
    startIndex = 2;
  }

  if (argv[0] === 'gateway' && argv[1] === 'status') {
    parsed.command = 'gateway-status';
    return parsed;
  }

  if (argv[0] === 'telegram' && argv[1] === 'setup') {
    parsed.command = 'telegram-setup';
    startIndex = 2;
  }

  if (argv[0] === 'telegram' && argv[1] === 'start') {
    parsed.command = 'telegram-start';
    startIndex = 2;
  }

  if (argv[0] === 'telegram' && argv[1] === 'status') {
    parsed.command = 'telegram-status';
    return parsed;
  }

  if (argv[0] === 'telegram' && (argv[1] === 'onboarding' || argv[1] === 'link')) {
    parsed.command = 'telegram-onboarding';
    return parsed;
  }

  if (argv[0] === 'telegram' && argv[1] === 'reset') {
    parsed.command = 'telegram-reset';
    return parsed;
  }

  for (let index = startIndex; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--interactive' || arg === '-i') {
      parsed.interactive = true;
      continue;
    }

    if (arg === '--provider') {
      const value = argv[index + 1];
      if (value && VALID_PROVIDERS.includes(value as YagrModelProvider)) {
        parsed.provider = value as YagrModelProvider;
        index += 1;
        continue;
      }
      throw new Error(`Invalid value for --provider. Use one of: ${VALID_PROVIDERS.join(', ')}.`);
    }

    if (arg === '--model') {
      parsed.model = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--max-steps') {
      const raw = argv[index + 1];
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('Invalid value for --max-steps. Use a positive integer.');
      }
      parsed.maxSteps = value;
      index += 1;
      continue;
    }

    if (arg === '--hide-thinking') {
      parsed.showThinking = false;
      continue;
    }

    if (arg === '--hide-agent-thinking') {
      parsed.showThinking = false;
      continue;
    }

    if (arg === '--hide-cli' || arg === '--hide-execution') {
      parsed.showExecution = false;
      continue;
    }

    if (arg === '--hide-command-executions') {
      parsed.showExecution = false;
      continue;
    }

    if (!parsed.prompt) {
      parsed.prompt = arg;
      continue;
    }

    parsed.prompt = `${parsed.prompt} ${arg}`;
  }

  if (!parsed.prompt) {
    parsed.interactive = true;
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configService = new YagrConfigService();

  if (args.command) {
    if (args.command === 'config-show') {
      const localConfig = configService.getLocalConfig();
      const setupStatus = getYagrSetupStatus(configService);
      const providers = VALID_PROVIDERS.map((provider) => ({
        provider,
        apiKeyStored: configService.hasApiKey(provider),
      })).filter((entry) => entry.apiKeyStored);

      process.stdout.write(`${JSON.stringify({ localConfig, providers, setupStatus }, null, 2)}\n`);
      return;
    }

    if (args.command === 'config-reset') {
      configService.clearLocalConfig();
      configService.clearAllApiKeys();
      process.stdout.write('Yagr config reset.\n');
      return;
    }

    if (args.command === 'telegram-setup') {
      await setupTelegramGateway(configService);
      return;
    }

    if (args.command === 'setup') {
      await runYagrSetup(configService);
      return;
    }

    if (args.command === 'gateway-status') {
      const status = getGatewaySupervisorStatus(configService);
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    if (args.command === 'telegram-status') {
      const status = getTelegramGatewayStatus(configService);
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    if (args.command === 'telegram-onboarding') {
      showTelegramOnboarding(configService);
      return;
    }

    if (args.command === 'telegram-reset') {
      resetTelegramGateway(configService);
      process.stdout.write('Yagr Telegram config reset.\n');
      return;
    }
  }

  if (args.command === 'gateway-start') {
    await runGatewaySupervisor(async () => await createN8nEngineFromWorkspace(), {
      provider: args.provider,
      model: args.model,
      maxSteps: args.maxSteps,
    }, configService);
    return;
  }

  if (args.command === 'start') {
    const status = getYagrSetupStatus(configService);
    if (!status.ready) {
      const completed = await runYagrSetup(configService);
      if (!completed) {
        return;
      }
    }

    await runGatewaySupervisor(async () => await createN8nEngineFromWorkspace(), {
      provider: args.provider,
      model: args.model,
      maxSteps: args.maxSteps,
    }, configService);
    return;
  }

  if (args.command === 'telegram-start') {
    await runTelegramGateway(async () => await createN8nEngineFromWorkspace(), {
      provider: args.provider,
      model: args.model,
      maxSteps: args.maxSteps,
    }, configService);
    return;
  }

  const engine = await createN8nEngineFromWorkspace();

  const agent = new YagrAgent(engine);
  const { runCliGateway } = await import('./gateway/cli.js');

  await runCliGateway(agent, {
    prompt: args.prompt,
    interactive: args.interactive,
    provider: args.provider,
    model: args.model,
    maxSteps: args.maxSteps,
    display: {
      showThinking: args.showThinking,
      showExecution: args.showExecution,
    },
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Yagr CLI error: ${message}\n`);
  process.exit(1);
});
