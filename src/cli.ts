#!/usr/bin/env node
import './config/init-yagr-home.js';
import os from 'node:os';
import { createN8nEngineFromWorkspace } from './config/load-n8n-engine-config.js';
import { buildYagrCleanupPlan, resetYagrLocalState, type YagrResetScope } from './config/local-state.js';
import { YagrConfigService } from './config/yagr-config-service.js';
import { getYagrPaths } from './config/yagr-home.js';
import { getGatewaySupervisorStatus, runGatewaySupervisor, runGatewaySurfaces, startGatewaySurfacesInBackground } from './gateway/manager.js';
import {
  getTelegramGatewayStatus,
  resetTelegramGateway,
  runTelegramGateway,
  showTelegramOnboarding,
  setupTelegramGateway,
} from './gateway/telegram.js';
import { YagrAgent } from './agent.js';
import type { YagrModelProvider } from './llm/create-language-model.js';
import { getYagrSetupStatus, refreshN8nWorkspaceInstructionsFromSavedConfig, runYagrSetup } from './setup.js';
import { promptForStartAction, type StartLaunchAction } from './setup/start-launcher.js';

const VALID_PROVIDERS: YagrModelProvider[] = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'mistral',
  'openrouter',
];

interface ParsedArgs {
  command?: 'config-show' | 'config-reset' | 'paths' | 'reset' | 'uninstall' | 'setup' | 'start' | 'gateway-start' | 'gateway-status' | 'telegram-setup' | 'telegram-start' | 'telegram-status' | 'telegram-reset' | 'telegram-onboarding';
  startTarget?: 'webui' | 'tui';
  prompt?: string;
  interactive: boolean;
  provider?: YagrModelProvider;
  model?: string;
  maxSteps?: number;
  showThinking: boolean;
  showExecution: boolean;
  yes: boolean;
  dryRun: boolean;
  resetScope?: YagrResetScope;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    interactive: false,
    showThinking: true,
    showExecution: true,
    yes: false,
    dryRun: false,
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

  if (argv[0] === 'paths') {
    parsed.command = 'paths';
    return parsed;
  }

  if (argv[0] === 'reset') {
    parsed.command = 'reset';
    startIndex = 1;
  }

  if (argv[0] === 'uninstall') {
    parsed.command = 'uninstall';
    startIndex = 1;
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

    if (parsed.command === 'start' && (arg === 'webui' || arg === 'tui')) {
      parsed.startTarget = arg;
      continue;
    }

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

    if (arg === '--yes') {
      parsed.yes = true;
      continue;
    }

    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--scope') {
      const value = argv[index + 1];
      if (value === 'config' || value === 'config+creds' || value === 'full') {
        parsed.resetScope = value;
        index += 1;
        continue;
      }

      throw new Error('Invalid value for --scope. Use one of: config, config+creds, full.');
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

async function promptForStartActionWithFallback(): Promise<StartLaunchAction> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return 'webui';
  }

  return promptForStartAction();
}

async function resolveStartTarget(args: ParsedArgs, configService: YagrConfigService): Promise<'webui' | 'tui' | undefined> {
  if (args.startTarget) {
    return args.startTarget;
  }

  for (;;) {
    const action = await promptForStartActionWithFallback();

    if (action === 'cancel') {
      return undefined;
    }

    if (action === 'onboard') {
      const completed = await runYagrSetup(configService);
      if (!completed) {
        return undefined;
      }
      continue;
    }

    return action;
  }
}

function getBackgroundGatewaySurfaces(configService: YagrConfigService) {
  const status = getGatewaySupervisorStatus(configService);
  return status.startableSurfaces.filter((id) => id !== 'webui');
}

async function runTui(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  const bgSurfaces = getBackgroundGatewaySurfaces(configService);
  const engine = await createN8nEngineFromWorkspace();
  const engineResolver = () => Promise.resolve(engine);

  const stopBgGateways = bgSurfaces.length > 0
    ? await startGatewaySurfacesInBackground(bgSurfaces, engineResolver, {
        provider: args.provider,
        model: args.model,
        maxSteps: args.maxSteps,
      }, configService)
    : async () => {};

  const agent = new YagrAgent(engine);
  const { runCliGateway } = await import('./gateway/cli.js');

  try {
    await runCliGateway(agent, {
      prompt: args.prompt,
      interactive: true,
      provider: args.provider,
      model: args.model,
      maxSteps: args.maxSteps,
      display: {
        showThinking: args.showThinking,
        showExecution: args.showExecution,
      },
    });
  } finally {
    await stopBgGateways();
  }
}

async function runWebUi(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  const bgSurfaces = getBackgroundGatewaySurfaces(configService);
  await runGatewaySurfaces(['webui', ...bgSurfaces], async () => await createN8nEngineFromWorkspace(), {
    provider: args.provider,
    model: args.model,
    maxSteps: args.maxSteps,
  }, configService);
}

async function refreshN8nWorkspaceInstructionsAtLaunch(): Promise<void> {
  try {
    await refreshN8nWorkspaceInstructionsFromSavedConfig();
  } catch (error) {
    process.stderr.write(`Warning: n8n workspace instructions refresh failed during launch: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configService = new YagrConfigService();

  if (args.command) {
    if (args.command === 'paths') {
      const cleanupPlan = buildYagrCleanupPlan('full');
      const payload = {
        launchDir: cleanupPlan.paths.launchDir,
        homeDir: cleanupPlan.paths.homeDir,
        os: process.platform,
        files: {
          yagrConfig: cleanupPlan.paths.yagrConfigPath,
          yagrCredentials: cleanupPlan.paths.yagrCredentialsPath,
          n8nConfig: cleanupPlan.paths.n8nConfigPath,
          n8nCredentials: cleanupPlan.paths.n8nCredentialsPath,
        },
        legacy: {
          yagrCredentials: cleanupPlan.paths.legacyYagrCredentialsPath,
          n8nCredentials: cleanupPlan.paths.legacyN8nCredentialsPath,
        },
        workspace: {
          managed: cleanupPlan.workspacePaths,
          preservedExternal: cleanupPlan.preservedWorkspacePaths,
        },
      };

      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    if (args.command === 'reset' || args.command === 'uninstall') {
      const scope = args.command === 'uninstall' ? 'full' : (args.resetScope ?? 'config+creds');
      if (!args.dryRun && !args.yes) {
        throw new Error('Refusing to remove local state without --yes. Use --dry-run to preview the cleanup plan.');
      }

      const result = await resetYagrLocalState(scope, { dryRun: args.dryRun });
      const payload = {
        scope,
        dryRun: args.dryRun,
        deletePaths: result.plan.deletePaths,
        preservedWorkspacePaths: result.plan.preservedWorkspacePaths,
      };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      if (args.command === 'uninstall') {
        const packageManagerHint = os.platform() === 'win32'
          ? 'npm uninstall -g @yagr/agent'
          : 'npm uninstall -g @yagr/agent';
        process.stdout.write(`CLI package remains installed. Remove it separately with: ${packageManagerHint}\n`);
      }
      return;
    }

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
      const completed = await runYagrSetup(configService);
      if (!completed) {
        return;
      }

      const startTarget = await resolveStartTarget(args, configService);
      if (!startTarget) {
        return;
      }

      if (startTarget === 'webui') {
        await runWebUi(args, configService);
        return;
      }

      await runTui(args, configService);
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
    await refreshN8nWorkspaceInstructionsAtLaunch();
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

    const startTarget = await resolveStartTarget(args, configService);
    if (!startTarget) {
      return;
    }

    if (startTarget === 'webui') {
      await refreshN8nWorkspaceInstructionsAtLaunch();
      await runWebUi(args, configService);
      return;
    }

    await refreshN8nWorkspaceInstructionsAtLaunch();
    await runTui(args, configService);
    return;
  }

  if (args.command === 'telegram-start') {
    await refreshN8nWorkspaceInstructionsAtLaunch();
    await runTelegramGateway(async () => await createN8nEngineFromWorkspace(), {
      provider: args.provider,
      model: args.model,
      maxSteps: args.maxSteps,
    }, configService);
    return;
  }

  await refreshN8nWorkspaceInstructionsAtLaunch();
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
