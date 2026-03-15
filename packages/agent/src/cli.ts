#!/usr/bin/env node
import { createN8nEngineFromWorkspace } from './config/load-n8n-engine-config.js';
import { HolonConfigService } from './config/holon-config-service.js';
import { runCliGateway } from './gateway/cli.js';
import { HolonAgent } from './agent.js';
import type { HolonModelProvider } from './llm/create-language-model.js';

const VALID_PROVIDERS: HolonModelProvider[] = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'mistral',
  'openrouter',
];

interface ParsedArgs {
  command?: 'config-show' | 'config-reset';
  prompt?: string;
  interactive: boolean;
  provider?: HolonModelProvider;
  model?: string;
  maxSteps?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    interactive: false,
  };

  if (argv[0] === 'config' && argv[1] === 'show') {
    parsed.command = 'config-show';
    return parsed;
  }

  if (argv[0] === 'config' && argv[1] === 'reset') {
    parsed.command = 'config-reset';
    return parsed;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--interactive' || arg === '-i') {
      parsed.interactive = true;
      continue;
    }

    if (arg === '--provider') {
      const value = argv[index + 1];
      if (value && VALID_PROVIDERS.includes(value as HolonModelProvider)) {
        parsed.provider = value as HolonModelProvider;
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

  if (args.command) {
    const configService = new HolonConfigService();

    if (args.command === 'config-show') {
      const localConfig = configService.getLocalConfig();
      const providers = VALID_PROVIDERS.map((provider) => ({
        provider,
        apiKeyStored: configService.hasApiKey(provider),
      })).filter((entry) => entry.apiKeyStored);

      process.stdout.write(`${JSON.stringify({ localConfig, providers }, null, 2)}\n`);
      return;
    }

    if (args.command === 'config-reset') {
      configService.clearLocalConfig();
      configService.clearAllApiKeys();
      process.stdout.write('Holon config reset.\n');
      return;
    }
  }

  const engine = await createN8nEngineFromWorkspace();
  const agent = new HolonAgent(engine);

  await runCliGateway(agent, {
    prompt: args.prompt,
    interactive: args.interactive,
    provider: args.provider,
    model: args.model,
    maxSteps: args.maxSteps,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Holon CLI error: ${message}\n`);
  process.exit(1);
});
