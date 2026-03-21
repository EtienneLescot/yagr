#!/usr/bin/env node
import './config/init-yagr-home.js';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createN8nEngineFromWorkspace } from './config/load-n8n-engine-config.js';
import { buildYagrCleanupPlan, resetYagrLocalState, type YagrResetScope } from './config/local-state.js';
import { YagrConfigService } from './config/yagr-config-service.js';
import { getYagrPaths } from './config/yagr-home.js';
import { getGatewaySupervisorStatus, getGatewayRunningBanner, runGatewaySupervisor, runGatewaySurfaces } from './gateway/manager.js';
import {
  getTelegramGatewayStatus,
  resetTelegramGateway,
  runTelegramGateway,
  showTelegramOnboarding,
  setupTelegramGateway,
} from './gateway/telegram.js';
import { YagrAgent } from './agent.js';
import type { YagrModelProvider } from './llm/create-language-model.js';
import {
  getManagedDockerN8nLogs,
  getManagedDockerN8nStatus,
  installManagedDockerN8n,
  startManagedDockerN8n,
  stopManagedDockerN8n,
} from './n8n-local/docker-manager.js';
import { formatLocalN8nBootstrapAssessment, inspectLocalN8nBootstrap } from './n8n-local/detect.js';
import { createN8nBootstrapPlan } from './n8n-local/plan.js';
import { getYagrSetupStatus, refreshN8nWorkspaceInstructionsFromSavedConfig, runYagrSetup } from './setup.js';

const VALID_PROVIDERS: YagrModelProvider[] = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'mistral',
  'openrouter',
];

interface ParsedArgs {
  command?: 'help' | 'version' | 'config-show' | 'config-reset' | 'paths' | 'reset' | 'uninstall' | 'setup' | 'start' | 'stop' | 'tui' | 'webui' | 'gateway-start' | 'gateway-status' | 'telegram-setup' | 'telegram-start' | 'telegram-status' | 'telegram-reset' | 'telegram-onboarding' | 'n8n-doctor' | 'n8n-local-install' | 'n8n-local-start' | 'n8n-local-stop' | 'n8n-local-status' | 'n8n-local-logs';
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

  if (argv.length === 0) {
    parsed.command = 'help';
    return parsed;
  }

  if (argv[0] === '--help' || argv[0] === '-h') {
    parsed.command = 'help';
    return parsed;
  }

  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === '-V') {
    parsed.command = 'version';
    return parsed;
  }

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

  if (argv[0] === 'stop') {
    parsed.command = 'stop';
    return parsed;
  }

  if (argv[0] === 'tui') {
    parsed.command = 'tui';
    return parsed;
  }

  if (argv[0] === 'webui') {
    parsed.command = 'webui';
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

  if (argv[0] === 'n8n' && argv[1] === 'doctor') {
    parsed.command = 'n8n-doctor';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'local' && argv[2] === 'install') {
    parsed.command = 'n8n-local-install';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'local' && argv[2] === 'start') {
    parsed.command = 'n8n-local-start';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'local' && argv[2] === 'status') {
    parsed.command = 'n8n-local-status';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'local' && argv[2] === 'stop') {
    parsed.command = 'n8n-local-stop';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'local' && argv[2] === 'logs') {
    parsed.command = 'n8n-local-logs';
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

async function spawnGatewayDaemon(args: ParsedArgs): Promise<number> {
  const { spawn } = await import('node:child_process');
  const { writeGatewayPid } = await import('./config/gateway-daemon.js');

  const extraArgs: string[] = [];
  if (args.provider) extraArgs.push('--provider', args.provider);
  if (args.model) extraArgs.push('--model', args.model);
  if (args.maxSteps) extraArgs.push('--max-steps', String(args.maxSteps));

  const child = spawn(
    process.execPath,
    [process.argv[1], 'gateway', 'start', ...extraArgs],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    },
  );

  child.unref();

  if (!child.pid) {
    throw new Error('Failed to spawn gateway daemon.');
  }

  writeGatewayPid(child.pid);
  return child.pid;
}

async function runGatewayOrFallback(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  await refreshN8nWorkspaceInstructionsAtLaunch();
  const supervisorStatus = getGatewaySupervisorStatus(configService);

  if (supervisorStatus.startableSurfaces.length === 0) {
    process.stdout.write([
      '',
      'Yagr is configured.',
      'No messaging gateways are enabled yet.',
      '  \u00b7 Run `yagr tui`     to open a terminal chat session.',
      '  \u00b7 Run `yagr webui`   to open the web interface.',
      '  \u00b7 Run `yagr setup`   to configure Telegram or other gateways.',
      '',
    ].join('\n'));
    return;
  }

  const { isGatewayRunning, getGatewayLogPath } = await import('./config/gateway-daemon.js');

  const running = isGatewayRunning();
  if (running.running) {
    process.stdout.write(`Gateway already running (PID ${running.pid}).\n`);
    process.stdout.write(getGatewayRunningBanner(configService, running.pid));
    return;
  }

  process.stdout.write('Starting Yagr gateway...\n');
  const pid = await spawnGatewayDaemon(args);

  // Give the daemon time to connect and fail fast if broken
  await new Promise<void>((resolve) => setTimeout(resolve, 2000));

  try {
    process.kill(pid, 0);
  } catch {
    const { clearGatewayPid } = await import('./config/gateway-daemon.js');
    clearGatewayPid();
    throw new Error(`Gateway daemon failed to start. Check logs: ${getGatewayLogPath()}`);
  }

  process.stdout.write(getGatewayRunningBanner(configService, pid));
}

async function runTui(args: ParsedArgs): Promise<void> {
  const engine = await createN8nEngineFromWorkspace();
  const agent = new YagrAgent(engine);
  const { runCliGateway } = await import('./gateway/cli.js');

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
}

async function runWebUi(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  await runGatewaySurfaces(['webui'], async () => await createN8nEngineFromWorkspace(), {
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

function getVersion(): string {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
}

function printHelp(): void {
  const help = `
Usage: yagr <command> [options]
       yagr [prompt]           Run agent with a one-shot prompt

Commands:
  setup                        Run the setup wizard
  start [tui|webui]            Start configured gateway(s), or a specific UI
  tui                          Open an interactive terminal chat session
  webui                        Open the web interface
  stop                         Stop the running gateway daemon

  gateway start                Start the gateway supervisor in the foreground
  gateway status               Show gateway status (JSON)

  telegram setup               Configure the Telegram gateway
  telegram start               Start the Telegram gateway in the foreground
  telegram status              Show Telegram gateway status (JSON)
  telegram onboarding          Show the Telegram onboarding/link URL
  telegram reset               Remove Telegram gateway configuration
  n8n doctor                   Inspect local n8n bootstrap readiness
  n8n local install            Install and start a Yagr-managed local n8n runtime
  n8n local start              Start the Yagr-managed local n8n runtime
  n8n local stop               Stop the Yagr-managed local n8n runtime
  n8n local status             Show status for the Yagr-managed local n8n runtime
  n8n local logs               Show recent logs for the Yagr-managed local n8n runtime

  config show                  Show current configuration (JSON)
  config reset                 Clear all configuration and stored credentials
  paths                        Show Yagr data paths (JSON)
  reset                        Reset local state (requires --yes)
  uninstall                    Remove all local data (requires --yes)

Agent options (for \`yagr [prompt]\` and most commands):
  --provider <name>            AI provider: ${VALID_PROVIDERS.join(', ')}
  --model <name>               Model name to use
  --max-steps <n>              Maximum number of agent steps
  --interactive, -i            Keep the session open after the prompt
  --hide-thinking              Hide agent thinking output
  --hide-execution             Hide tool execution output
  --yes                        Auto-confirm destructive operations
  --dry-run                    Preview without making changes

Info:
  --version, -v                Print version
  --help, -h                   Show this help
`;
  process.stdout.write(help);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'version') {
    process.stdout.write(`${getVersion()}\n`);
    return;
  }

  if (args.command === 'help') {
    printHelp();
    return;
  }

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
      await runGatewayOrFallback(args, configService);
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

    if (args.command === 'n8n-doctor') {
      const assessment = await inspectLocalN8nBootstrap();
      const plan = createN8nBootstrapPlan({ target: 'local-managed', assessment });
      process.stdout.write(formatLocalN8nBootstrapAssessment(assessment));
      process.stdout.write(`Bootstrap automation target: ${plan.automationLevel}\n`);
      process.stdout.write(`Bootstrap can proceed: ${plan.canProceed ? 'yes' : 'no'}\n`);
      if (plan.reasons.length > 0) {
        process.stdout.write('Plan notes:\n');
        for (const reason of plan.reasons) {
          process.stdout.write(`- ${reason}\n`);
        }
      }
      return;
    }

    if (args.command === 'n8n-local-install') {
      const state = await installManagedDockerN8n();
      process.stdout.write(`Managed local n8n installed and started at ${state.url}\n`);
      process.stdout.write('Next: open the URL, create the owner account, generate an API key, then run `yagr setup`.\n');
      return;
    }

    if (args.command === 'n8n-local-start') {
      const state = await startManagedDockerN8n();
      process.stdout.write(`Managed local n8n is running at ${state.url}\n`);
      return;
    }

    if (args.command === 'n8n-local-status') {
      const status = await getManagedDockerN8nStatus();
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    if (args.command === 'n8n-local-stop') {
      const state = await stopManagedDockerN8n();
      process.stdout.write(`Managed local n8n stopped for ${state.url}\n`);
      return;
    }

    if (args.command === 'n8n-local-logs') {
      const logs = await getManagedDockerN8nLogs();
      process.stdout.write(`${logs}\n`);
      return;
    }
  }

  if (args.command === 'stop') {
    const { isGatewayRunning, clearGatewayPid } = await import('./config/gateway-daemon.js');
    const running = isGatewayRunning();
    if (!running.running || !running.pid) {
      process.stdout.write('No gateway is currently running.\n');
      return;
    }

    process.kill(running.pid, 'SIGTERM');
    // Give the process a moment to clean up, then ensure PID file is gone
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    clearGatewayPid();
    process.stdout.write(`Gateway stopped (PID ${running.pid}).\n`);
    return;
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

    if (args.startTarget === 'tui') {
      await refreshN8nWorkspaceInstructionsAtLaunch();
      await runTui(args);
      return;
    }

    if (args.startTarget === 'webui') {
      await refreshN8nWorkspaceInstructionsAtLaunch();
      await runWebUi(args, configService);
      return;
    }

    // No explicit target — start all configured gateways
    await runGatewayOrFallback(args, configService);
    return;
  }

  if (args.command === 'tui') {
    const status = getYagrSetupStatus(configService);
    if (!status.ready) {
      const completed = await runYagrSetup(configService);
      if (!completed) {
        return;
      }
    }
    await refreshN8nWorkspaceInstructionsAtLaunch();
    await runTui(args);
    return;
  }

  if (args.command === 'webui') {
    const status = getYagrSetupStatus(configService);
    if (!status.ready) {
      const completed = await runYagrSetup(configService);
      if (!completed) {
        return;
      }
    }
    await refreshN8nWorkspaceInstructionsAtLaunch();
    await runWebUi(args, configService);
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
