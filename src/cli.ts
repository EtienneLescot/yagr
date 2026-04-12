#!/usr/bin/env node
import './config/init-yagr-home.js';
import os from 'node:os';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildYagrCleanupPlan, resetYagrLocalState, type YagrResetScope } from './config/local-state.js';
import { YagrN8nConfigService } from './config/n8n-config-service.js';
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
import { createYagrDeepAgent } from './agent-factory.js';
import type { YagrModelProvider } from './llm/provider-registry.js';
import {
  getManagedDockerN8nLogs,
  getManagedDockerN8nStatus,
  installManagedDockerN8n,
  startManagedDockerN8n,
  stopManagedDockerN8n,
} from './n8n-local/docker-manager.js';
import {
  getManagedDirectN8nStatus,
  getManagedDirectN8nLogs,
  installManagedDirectN8n,
  startManagedDirectN8n,
  stopManagedDirectN8n,
} from './n8n-local/direct-manager.js';
import { formatLocalN8nBootstrapAssessment, inspectLocalN8nBootstrap } from './n8n-local/detect.js';
import {
  prepareConfiguredN8nForLaunch,
  getConfiguredManagedN8nState,
} from './n8n-local/managed-runtime.js';
import { createN8nBootstrapPlan } from './n8n-local/plan.js';
import { presentWorkflowResultCli } from './manager-tooling/present-workflow.js';
import { runYagrProxyCli, syncProxyCredentialIfEnabled } from './manager-tooling/yagr-proxy.js';
import { readManagedN8nState } from './n8n-local/state.js';
import { getYagrSetupStatus, refreshN8nWorkspaceInstructionsFromSavedConfig, registerN8nContextSources, runYagrLlmSetup, runYagrLlmProxySetup, runYagrN8nSetup, runYagrSetup } from './setup.js';
import { YagrSetupApplicationService } from './setup/application-services.js';
import { openExternalUrl } from './system/open-external.js';
import { YAGR_SELECTABLE_MODEL_PROVIDERS } from './llm/provider-registry.js';
import { getProxyRuntimeStatus, listProxyRuntimeStatuses, startProviderProxy, stopProviderProxy } from './llm/proxy-runtime.js';
import {
  getActiveTunnelState,
  getActiveWorkflowOpenTunnelState,
  installCloudflaredIfNeeded,
  isCloudflaredAvailable,
  isLocalUrl,
  refreshN8nTunnel,
  resolveN8nTunnelTargetUrl,
  startN8nTunnel,
  startWorkflowOpenTunnel,
  stopN8nTunnel,
} from './n8n-local/n8n-tunnel.js';
import { ensureN8nRelayServer } from './llm/llm-relay-server.js';
import { ensureLocalWorkflowOpenBridgeRunning, getLocalWorkflowOpenBridgeBaseUrl } from './gateway/local-open-bridge.js';

const VALID_PROVIDERS: YagrModelProvider[] = [...YAGR_SELECTABLE_MODEL_PROVIDERS];
const CLI_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface ParsedArgs {
  command?: 'help' | 'version' | 'config-show' | 'config-reset' | 'paths' | 'reset' | 'uninstall' | 'setup' | 'llm-setup' | 'llm-proxy-setup' | 'start' | 'stop' | 'tui' | 'webui' | 'gateway-start' | 'gateway-worker' | 'gateway-status' | 'telegram-setup' | 'telegram-start' | 'telegram-status' | 'telegram-reset' | 'telegram-onboarding' | 'proxy-start' | 'proxy-status' | 'proxy-stop' | 'n8n-setup' | 'n8n-context-setup' | 'n8n-doctor' | 'n8n-local-install' | 'n8n-local-start' | 'n8n-local-stop' | 'n8n-local-status' | 'n8n-local-logs' | 'n8n-local-open' | 'n8n-tunnel-setup' | 'n8n-tunnel-start' | 'n8n-tunnel-stop' | 'n8n-tunnel-refresh' | 'n8n-tunnel-status' | 'n8n-tunnel-url' | 'presentWorkflowResult' | 'yagrProxy';
  startTarget?: 'webui' | 'tui';
  n8nLocalRuntime?: 'docker' | 'direct';
  prompt?: string;
  interactive: boolean;
  provider?: YagrModelProvider;
  model?: string;
  maxSteps?: number;
  showThinking: boolean;
  showExecution: boolean;
  debug: boolean;
  yes: boolean;
  dryRun: boolean;
  resetScope?: YagrResetScope;
  workflowId?: string;
  workflowUrl?: string;
  title?: string;
  diagramFile?: string;
  executionStatus?: 'success' | 'error' | 'waiting';
  executionId?: string;
  executionSummary?: string;
  executionDataFile?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    interactive: false,
    showThinking: true,
    showExecution: true,
    debug: false,
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

  if (argv[0] === 'presentWorkflowResult') {
    parsed.command = 'presentWorkflowResult';
    startIndex = 1;
  }

  if (argv[0] === 'yagrProxy') {
    parsed.command = 'yagrProxy';
    startIndex = 1;
  }

  if (argv[0] === 'setup' || argv[0] === 'onboard') {
    parsed.command = 'setup';
    startIndex = 1;
  }

  if (argv[0] === 'llm' && argv[1] === 'setup') {
    parsed.command = 'llm-setup';
    startIndex = 2;
  }

  if (argv[0] === 'start') {
    parsed.command = 'start';
    startIndex = 1;
  }

  if (argv[0] === 'gateway' && argv[1] === 'start') {
    parsed.command = 'gateway-start';
    startIndex = 2;
  }

  if (argv[0] === 'gateway' && argv[1] === 'worker') {
    parsed.command = 'gateway-worker';
    startIndex = 2;
  }

  if (argv[0] === 'gateway' && argv[1] === 'status') {
    parsed.command = 'gateway-status';
    return parsed;
  }

  if (argv[0] === 'llm' && argv[1] === 'proxy' && argv[2] === 'setup') {
    parsed.command = 'llm-proxy-setup';
    startIndex = 3;
  }

  if (argv[0] === 'proxy' && argv[1] === 'start') {
    parsed.command = 'proxy-start';
    startIndex = 2;
  }

  if (argv[0] === 'proxy' && argv[1] === 'status') {
    parsed.command = 'proxy-status';
    startIndex = 2;
  }

  if (argv[0] === 'proxy' && argv[1] === 'stop') {
    parsed.command = 'proxy-stop';
    startIndex = 2;
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

  if (argv[0] === 'n8n' && argv[1] === 'setup') {
    parsed.command = 'n8n-setup';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'context' && argv[2] === 'setup') {
    parsed.command = 'n8n-context-setup';
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

  if (argv[0] === 'n8n' && argv[1] === 'local' && argv[2] === 'open') {
    parsed.command = 'n8n-local-open';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'tunnel' && argv[2] === 'start') {
    parsed.command = 'n8n-tunnel-start';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'tunnel' && argv[2] === 'setup') {
    parsed.command = 'n8n-tunnel-setup';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'tunnel' && argv[2] === 'stop') {
    parsed.command = 'n8n-tunnel-stop';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'tunnel' && argv[2] === 'refresh') {
    parsed.command = 'n8n-tunnel-refresh';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'tunnel' && argv[2] === 'status') {
    parsed.command = 'n8n-tunnel-status';
    return parsed;
  }

  if (argv[0] === 'n8n' && argv[1] === 'tunnel' && argv[2] === 'url') {
    parsed.command = 'n8n-tunnel-url';
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

    if (arg === '--debug') {
      parsed.debug = true;
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

    if (arg === '--runtime') {
      const value = argv[index + 1];
      if (value === 'docker' || value === 'direct') {
        parsed.n8nLocalRuntime = value;
        index += 1;
        continue;
      }

      throw new Error('Invalid value for --runtime. Use one of: docker, direct.');
    }

    if (arg === '--workflow-id') {
      parsed.workflowId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--workflow-url') {
      parsed.workflowUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--title') {
      parsed.title = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--diagram-file') {
      parsed.diagramFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--execution-status') {
      const value = argv[index + 1];
      if (value === 'success' || value === 'error' || value === 'waiting') {
        parsed.executionStatus = value;
        index += 1;
        continue;
      }

      throw new Error('Invalid value for --execution-status. Use one of: success, error, waiting.');
    }

    if (arg === '--execution-id') {
      parsed.executionId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--execution-summary') {
      parsed.executionSummary = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--execution-data-file') {
      parsed.executionDataFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--docker') {
      parsed.n8nLocalRuntime = 'docker';
      continue;
    }

    if (arg === '--direct' || arg === '--non-docker') {
      parsed.n8nLocalRuntime = 'direct';
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

async function runWithSpinner<T>(message: string, task: () => Promise<T>, detail?: string): Promise<T> {
  if (!process.stdout.isTTY) {
    if (detail) {
      process.stdout.write(`${message}\n`);
      process.stdout.write(`${detail}\n`);
    } else {
      process.stdout.write(`${message}\n`);
    }
    return task();
  }

  const startedAt = Date.now();
  let frame = 0;
  const render = () => {
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const elapsedLabel = elapsedSeconds < 60
      ? `${elapsedSeconds}s`
      : `${Math.floor(elapsedSeconds / 60)}m ${String(elapsedSeconds % 60).padStart(2, '0')}s`;
    const detailText = detail ? ` ${detail}` : '';
    process.stdout.write(`\r${CLI_SPINNER_FRAMES[frame % CLI_SPINNER_FRAMES.length]} ${message}${detailText} Elapsed: ${elapsedLabel}`);
    frame += 1;
  };

  render();
  const interval = setInterval(render, 120);

  try {
    const result = await task();
    clearInterval(interval);
    process.stdout.write(`\r✓ ${message}\n`);
    return result;
  } catch (error) {
    clearInterval(interval);
    process.stdout.write(`\r✕ ${message}\n`);
    throw error;
  }
}

async function spawnGatewayDaemon(args: ParsedArgs): Promise<number> {
  const { spawn } = await import('node:child_process');
  const { getGatewayLogPath, writeGatewayPid } = await import('./config/gateway-daemon.js');

  const extraArgs: string[] = [];
  if (args.provider) extraArgs.push('--provider', args.provider);
  if (args.model) extraArgs.push('--model', args.model);
  if (args.maxSteps) extraArgs.push('--max-steps', String(args.maxSteps));
  const logPath = getGatewayLogPath();
  const logFd = fs.openSync(logPath, 'a');
  let child;
  try {
    child = spawn(
      process.execPath,
      [process.argv[1], 'gateway', 'start', ...extraArgs],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env },
      },
    );
  } finally {
    fs.closeSync(logFd);
  }

  child.unref();

  if (!child.pid) {
    throw new Error('Failed to spawn gateway daemon.');
  }

  writeGatewayPid(child.pid);
  return child.pid;
}

function formatGatewayTimestamp(date = new Date()): string {
  return date.toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getGatewayRestartDelayMs(failureCount: number): number {
  const cappedFailures = Math.max(0, Math.min(failureCount, 6));
  return Math.min(30_000, 1_000 * (2 ** cappedFailures));
}

async function runGatewayWorker(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  await ensureManagedN8nAtLaunch();
  await refreshN8nWorkspaceInstructionsAtLaunch();
  await ensureRelayAtLaunch();
  await ensureTunnelAtLaunch();
  await runGatewaySupervisor({
    provider: args.provider,
    model: args.model,
    maxSteps: args.maxSteps,
  }, configService);
}

async function runGatewaySupervisorProcess(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  const { spawn } = await import('node:child_process');
  const supervisorStatus = getGatewaySupervisorStatus(configService);

  if (supervisorStatus.startableSurfaces.length === 0) {
    const message = supervisorStatus.warnings[0] ?? 'No enabled and configured gateway surfaces are available.';
    throw new Error(message);
  }

  let stopRequested = false;
  let activeChild: import('node:child_process').ChildProcess | undefined;
  let consecutiveFailures = 0;

  const forwardStop = () => {
    stopRequested = true;
    if (activeChild?.pid) {
      try {
        activeChild.kill('SIGTERM');
      } catch {
        // Child already exited.
      }
    }
  };

  process.once('SIGINT', forwardStop);
  process.once('SIGTERM', forwardStop);

  while (!stopRequested) {
    const childArgs = [process.argv[1], 'gateway', 'worker'];
    if (args.provider) childArgs.push('--provider', args.provider);
    if (args.model) childArgs.push('--model', args.model);
    if (args.maxSteps) childArgs.push('--max-steps', String(args.maxSteps));

    const child = spawn(process.execPath, childArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        YAGR_GATEWAY_SUPERVISOR_PID: String(process.pid),
      },
    });
    activeChild = child;
    const startedAt = Date.now();

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    activeChild = undefined;

    if (stopRequested) {
      break;
    }

    const uptimeMs = Date.now() - startedAt;
    if (exit.code === 0) {
      process.stdout.write(`[${formatGatewayTimestamp()}] Gateway worker stopped cleanly.\n`);
      break;
    }

    consecutiveFailures = uptimeMs >= 60_000 ? 0 : consecutiveFailures + 1;
    const delayMs = getGatewayRestartDelayMs(consecutiveFailures);
    const reason = exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code ?? 'unknown'}`;
    process.stderr.write(
      `[${formatGatewayTimestamp()}] Gateway worker exited with ${reason}. Restarting in ${Math.round(delayMs / 1000)}s.\n`,
    );
    await sleep(delayMs);
  }
}

async function runGatewayOrFallback(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  await ensureManagedN8nAtLaunch();
  await refreshN8nWorkspaceInstructionsAtLaunch();
  await ensureRelayAtLaunch();
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
  const handle = await createYagrDeepAgent();
  const { runCliGateway } = await import('./gateway/cli.js');

  await runCliGateway(handle, {
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

function readOptionalTextFile(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }

  return fs.readFileSync(filePath, 'utf8');
}

async function runWebUi(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  await runGatewaySurfaces(['webui'], {
    provider: args.provider,
    model: args.model,
    maxSteps: args.maxSteps,
  }, configService);
}

async function ensureManagedN8nAtLaunch(): Promise<void> {
  try {
    const preparation = await prepareConfiguredN8nForLaunch();
    if (preparation.warning) {
      process.stderr.write(`Warning: ${preparation.warning}\n`);
    }

    if (!preparation.started || !preparation.state) {
      return;
    }

    const modeLabel = preparation.state.strategy === 'direct' ? 'non-Docker' : 'Docker';
    process.stdout.write(`Restarted Yagr-managed n8n (${modeLabel}) at ${preparation.state.url}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\nError: Could not start n8n.\n${message}\n\n`);
    process.exit(1);
  }
}

async function refreshN8nWorkspaceInstructionsAtLaunch(): Promise<void> {
  try {
    await refreshN8nWorkspaceInstructionsFromSavedConfig();
  } catch (error) {
    process.stderr.write(`Warning: n8n workspace instructions refresh failed during launch: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function ensureRelayAtLaunch(): Promise<void> {
  const configService = new YagrConfigService();
  const llmProxy = configService.getLocalConfig().llmProxy;
  if (!llmProxy?.enabled) return;
  try {
    await ensureN8nRelayServer();
    // Sync the n8n credential after the relay is up. This self-heals stale or
    // missing credentials caused by relay port changes between restarts.
    await syncProxyCredentialIfEnabled();
  } catch (error) {
    process.stderr.write(`Warning: LLM relay server failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function ensureTunnelAtLaunch(): Promise<void> {
  const configService = new YagrConfigService();
  const tunnelConfig = configService.getN8nTunnelConfig();
  if (!tunnelConfig?.enabled) return;

  const active = getActiveTunnelState();
  if (!active) {
    try {
      const targetUrl = resolveN8nTunnelTargetUrl();
      const bin = await installCloudflaredIfNeeded();
      const state = await startN8nTunnel(targetUrl, bin);
      configService.saveN8nTunnelConfig({ ...tunnelConfig, publicUrl: state.publicUrl, targetUrl });

      // Sync the tunnel URL into n8nac-config.json so webhook URLs are correct.
      const n8nConfigService = new YagrN8nConfigService();
      n8nConfigService.syncN8nacHostUrl(state.publicUrl);

      process.stdout.write(`Cloudflare Tunnel started: ${state.publicUrl}\n`);
      await restartManagedN8nForTunnel(state.publicUrl);
    } catch (error) {
      process.stderr.write(`Warning: n8n tunnel failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  if (!getActiveWorkflowOpenTunnelState()) {
    try {
      await ensureLocalWorkflowOpenBridgeRunning();
      const bin = await installCloudflaredIfNeeded();
      const publicUrl = await startWorkflowOpenTunnel(getLocalWorkflowOpenBridgeBaseUrl(), bin);
      process.stdout.write(`Workflow open bridge tunnel started: ${publicUrl}\n`);
    } catch (error) {
      process.stderr.write(`Warning: workflow open bridge tunnel failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

/**
 * If a Yagr-managed n8n instance is currently running, restart it so it picks
 * up the new N8N_WEBHOOK_URL. The managers inject the URL from the active
 * tunnel state, so we just need to trigger a stop → start cycle.
 */
async function restartManagedN8nForTunnel(publicUrl: string): Promise<void> {
  const managedState = getConfiguredManagedN8nState();
  if (!managedState || managedState.status === 'stopped') return;

  // Keep n8nac's host URL in sync with the active tunnel public URL
  // so that webhook URLs constructed by n8nac use the correct public origin.
  new YagrN8nConfigService().syncN8nacHostUrl(publicUrl);

  process.stdout.write(`\nRestarting managed n8n so it picks up N8N_WEBHOOK_URL=${publicUrl}…\n`);
  try {
    if (managedState.strategy === 'docker') {
      await stopManagedDockerN8n();
      await startManagedDockerN8n();
    } else {
      await stopManagedDirectN8n();
      await startManagedDirectN8n();
    }
    process.stdout.write(`n8n restarted. Webhook URLs in the editor now show the public URL.\n`);
  } catch (err) {
    process.stderr.write(`Warning: could not restart managed n8n: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(`Run \`yagr n8n local start\` manually to apply the new webhook URL.\n`);
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
  n8n setup                    Reconfigure only the n8n instance
  llm setup                    Run only the LLM setup wizard
  llm proxy setup              Configure the LLM proxy only
  start [tui|webui]            Start configured gateway(s), or a specific UI
  tui                          Open an interactive terminal chat session
  webui                        Open the web interface
  stop                         Stop the running gateway daemon

  gateway start                Start the gateway supervisor in the foreground
  gateway status               Show gateway status (JSON)
  proxy start                  Start a managed local model proxy
  proxy status                 Show managed proxy status (JSON)
  proxy stop                   Stop a managed local model proxy

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
  n8n local open               Open the Yagr-managed local n8n runtime in the browser
  n8n tunnel setup             Install cloudflared (if needed) and start the tunnel
  n8n tunnel start             Start the tunnel (cloudflared must be installed)
  n8n tunnel stop              Stop the running n8n Cloudflare Tunnel
  n8n tunnel refresh           Renew the tunnel (stop + start, new public URL)
  n8n tunnel status            Show tunnel status (JSON)
  n8n tunnel url               Print the current public tunnel URL
  n8n context setup            Register n8n workspace context for the agent
  presentWorkflowResult        Internal manager command for workflow presentation JSON
  yagrProxy                    Internal manager command for LLM proxy status JSON

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
  --debug                      Enable debug logs for setup/model discovery
  --runtime <docker|direct>    Runtime for \`n8n local install\`
  --docker                     Shortcut for \`n8n local install --runtime docker\`
  --direct, --non-docker       Shortcut for \`n8n local install --runtime direct\`
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
  const setupService = new YagrSetupApplicationService(configService, new YagrN8nConfigService());

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
      setupService.resetYagrConfig();
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
      // After onboarding, if n8n is a Yagr-managed instance and no tunnel is configured yet, offer tunnel setup.
      const managedN8nState = getConfiguredManagedN8nState();
      const tunnelCfg = configService.getN8nTunnelConfig();
      if (managedN8nState && managedN8nState.status !== 'stopped' && !tunnelCfg?.enabled) {
        process.stdout.write('\n──────────────────────────────────────────────────\n');
        process.stdout.write('Your n8n instance is local. Setting up a Cloudflare Tunnel\n');
        process.stdout.write('so it is reachable for webhooks and Telegram triggers…\n\n');
        try {
          const targetUrl = resolveN8nTunnelTargetUrl();
          const bin = await installCloudflaredIfNeeded((msg) => process.stdout.write(`${msg}\n`));
          const tunnelState = await runWithSpinner(
            `Starting Cloudflare Tunnel for ${targetUrl}…`,
            () => startN8nTunnel(targetUrl, bin),
            'Waiting for cloudflared to emit a public URL (up to 30s).',
          );
          configService.saveN8nTunnelConfig({ enabled: true, targetUrl, publicUrl: tunnelState.publicUrl });
          process.stdout.write(`\nTunnel ready: ${tunnelState.publicUrl}\n`);
          process.stdout.write(`The tunnel will restart automatically on next \`yagr start\`.\n`);
        } catch (err) {
          process.stdout.write(`Tunnel setup skipped: ${(err as Error).message}\n`);
          process.stdout.write('You can run it later with `yagr n8n tunnel setup`.\n');
        }
        process.stdout.write('──────────────────────────────────────────────────\n\n');
      }
      await runGatewayOrFallback(args, configService);
      return;
    }

    if (args.command === 'n8n-setup') {
      await runYagrN8nSetup(configService);
      return;
    }

    if (args.command === 'n8n-context-setup') {
      registerN8nContextSources();
      process.stdout.write('n8n workspace context registered in ~/.yagr/memory-sources.json\n');
      return;
    }

    if (args.command === 'llm-setup') {
      if (args.debug) {
        process.env.YAGR_DEBUG_MODEL_DISCOVERY = '1';
      }
      await runYagrLlmSetup(configService);
      // Re-sync the proxy credential after LLM config changes (best-effort).
      await syncProxyCredentialIfEnabled().catch(() => {});
      return;
    }

    if (args.command === 'llm-proxy-setup') {
      await runYagrLlmProxySetup(configService);
      return;
    }

    if (args.command === 'gateway-status') {
      const status = getGatewaySupervisorStatus(configService);
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    if (args.command === 'proxy-status') {
      const payload = args.provider
        ? getProxyRuntimeStatus(args.provider)
        : listProxyRuntimeStatuses();
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    if (args.command === 'proxy-start') {
      if (!args.provider) {
        throw new Error(`proxy start requires --provider. Use one of: ${VALID_PROVIDERS.join(', ')}.`);
      }
      const status = startProviderProxy(args.provider);
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    if (args.command === 'proxy-stop') {
      if (!args.provider) {
        throw new Error(`proxy stop requires --provider. Use one of: ${VALID_PROVIDERS.join(', ')}.`);
      }
      const status = stopProviderProxy(args.provider);
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
      const assessment = await inspectLocalN8nBootstrap();
      const runtime = args.n8nLocalRuntime ?? assessment.recommendedStrategy;
      const state = runtime === 'direct'
        ? await runWithSpinner(
          'Installing and starting a Yagr-managed local n8n instance…',
          () => installManagedDirectN8n(),
          'Direct runtime mode. This can take 1 to 3 minutes on first run.',
        )
        : runtime === 'docker'
          ? await runWithSpinner(
            'Installing and starting a Yagr-managed local n8n instance…',
            () => installManagedDockerN8n(),
            'Docker mode. Waiting for the n8n API and editor to become ready.',
          )
          : (() => {
            throw new Error('No supported automatic local n8n runtime is available. Re-run with --runtime docker or --runtime direct after installing the required prerequisite.');
          })();
      process.stdout.write(`Managed local n8n installed and started at ${state.url}\n`);
      process.stdout.write('Next: run `yagr onboard` to continue with silent bootstrap and assisted fallback.\n');
      return;
    }

    if (args.command === 'n8n-local-start') {
      const current = readManagedN8nState();
      const state = current?.strategy === 'direct'
        ? await runWithSpinner(
          'Starting the Yagr-managed local n8n instance…',
          () => startManagedDirectN8n(),
          'Direct runtime mode.',
        )
        : await runWithSpinner(
          'Starting the Yagr-managed local n8n instance…',
          () => startManagedDockerN8n(),
          'Docker mode.',
        );
      process.stdout.write(`Managed local n8n is running at ${state.url}\n`);
      return;
    }

    if (args.command === 'n8n-local-status') {
      const current = readManagedN8nState();
      const status = current?.strategy === 'direct'
        ? await getManagedDirectN8nStatus()
        : await getManagedDockerN8nStatus();
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    if (args.command === 'n8n-local-stop') {
      const current = readManagedN8nState();
      const state = current?.strategy === 'direct'
        ? await stopManagedDirectN8n()
        : await stopManagedDockerN8n();
      process.stdout.write(`Managed local n8n stopped for ${state.url}\n`);
      return;
    }

    if (args.command === 'n8n-local-logs') {
      const current = readManagedN8nState();
      const logs = current?.strategy === 'direct'
        ? await getManagedDirectN8nLogs()
        : await getManagedDockerN8nLogs();
      process.stdout.write(`${logs}\n`);
      return;
    }

    if (args.command === 'n8n-local-open') {
      const state = readManagedN8nState();
      if (!state) {
        throw new Error('No Yagr-managed local n8n instance is installed yet.');
      }
      await openExternalUrl(state.url);
      process.stdout.write(`Opened ${state.url}\n`);
      return;
    }

    if (args.command === 'n8n-tunnel-setup') {
      const targetUrl = resolveN8nTunnelTargetUrl();
      const alreadyAvailable = await isCloudflaredAvailable();
      if (!alreadyAvailable) {
        process.stdout.write('cloudflared not found. Downloading…\n');
      }

      const bin = await installCloudflaredIfNeeded((msg) => process.stdout.write(`${msg}\n`));
      const state = await runWithSpinner(
        `Starting Cloudflare Tunnel for ${targetUrl}…`,
        () => startN8nTunnel(targetUrl, bin),
        'Waiting for cloudflared to emit a public URL (up to 30s).',
      );
      const config = new YagrConfigService();
      config.saveN8nTunnelConfig({ enabled: true, targetUrl, publicUrl: state.publicUrl });

      // Update n8nac-config.json host URL so webhook URLs are correct.
      new YagrN8nConfigService().syncN8nacHostUrl(state.publicUrl);

      process.stdout.write(`\nTunnel ready: ${state.publicUrl}\n`);
      process.stdout.write(`Target: ${state.targetUrl}  PID: ${state.pid}\n`);
      process.stdout.write(`\nThe tunnel will restart automatically on next \`yagr start\` / \`yagr gateway start\`.\n`);
      await restartManagedN8nForTunnel(state.publicUrl);
      return;
    }

    if (args.command === 'n8n-tunnel-start') {
      const targetUrl = resolveN8nTunnelTargetUrl();
      const bin = await installCloudflaredIfNeeded((msg) => process.stdout.write(`${msg}\n`));
      const state = await runWithSpinner(
        `Starting Cloudflare Tunnel for ${targetUrl}…`,
        () => startN8nTunnel(targetUrl, bin),
        'Waiting for cloudflared to emit a public URL (up to 30s).',
      );
      const config = new YagrConfigService();
      config.saveN8nTunnelConfig({ enabled: true, targetUrl, publicUrl: state.publicUrl });

      // Update n8nac-config.json host URL so webhook URLs are correct.
      new YagrN8nConfigService().syncN8nacHostUrl(state.publicUrl);

      process.stdout.write(`Tunnel started: ${state.publicUrl}\n`);
      process.stdout.write(`Target: ${state.targetUrl}  PID: ${state.pid}\n`);
      await restartManagedN8nForTunnel(state.publicUrl);
      return;
    }

    if (args.command === 'n8n-tunnel-stop') {
      await stopN8nTunnel();
      const config = new YagrConfigService();
      config.clearN8nTunnelConfig();

      // Revert n8nac-config.json host back to the local n8n URL.
      const managedState = readManagedN8nState();
      const localHost = `http://127.0.0.1:${managedState?.port ?? 5678}`;
      new YagrN8nConfigService().syncN8nacHostUrl(localHost);

      process.stdout.write('Tunnel stopped.\n');
      return;
    }

    if (args.command === 'n8n-tunnel-refresh') {
      const targetUrl = resolveN8nTunnelTargetUrl();
      const bin = await installCloudflaredIfNeeded((msg) => process.stdout.write(`${msg}\n`));
      const state = await runWithSpinner(
        `Refreshing Cloudflare Tunnel for ${targetUrl}…`,
        () => refreshN8nTunnel(targetUrl, bin),
        'Stopping current tunnel and starting a new one.',
      );
      const config = new YagrConfigService();
      config.saveN8nTunnelConfig({ enabled: true, targetUrl, publicUrl: state.publicUrl });

      // Update n8nac-config.json host URL so webhook URLs are correct.
      new YagrN8nConfigService().syncN8nacHostUrl(state.publicUrl);

      process.stdout.write(`Tunnel refreshed: ${state.publicUrl}\n`);
      process.stdout.write(`Target: ${state.targetUrl}  PID: ${state.pid}\n`);
      await restartManagedN8nForTunnel(state.publicUrl);
      return;
    }

    if (args.command === 'n8n-tunnel-status') {
      const active = getActiveTunnelState();
      const payload = active
        ? { running: true, publicUrl: active.publicUrl, targetUrl: active.targetUrl, pid: active.pid, startedAt: active.startedAt }
        : { running: false };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    if (args.command === 'n8n-tunnel-url') {
      const active = getActiveTunnelState();
      if (!active) {
        process.stdout.write('No tunnel is currently active. Run `yagr n8n tunnel start` first.\n');
        return;
      }

      process.stdout.write(`${active.publicUrl}\n`);
      return;
    }

    if (args.command === 'presentWorkflowResult') {
      if (!args.workflowId) {
        throw new Error('presentWorkflowResult requires --workflow-id.');
      }

      const payload = await presentWorkflowResultCli({
        workflowId: args.workflowId,
        workflowUrl: args.workflowUrl,
        title: args.title,
        diagram: readOptionalTextFile(args.diagramFile),
        executionResult: args.executionStatus
          ? {
              status: args.executionStatus,
              executionId: args.executionId,
              summary: args.executionSummary,
              data: readOptionalTextFile(args.executionDataFile),
            }
          : undefined,
      });
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    if (args.command === 'yagrProxy') {
      const payload = await runYagrProxyCli();
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
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
    await runGatewaySupervisorProcess(args, configService);
    return;
  }

  if (args.command === 'gateway-worker') {
    await runGatewayWorker(args, configService);
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
      await ensureManagedN8nAtLaunch();
      await refreshN8nWorkspaceInstructionsAtLaunch();
      await ensureRelayAtLaunch();
      await ensureTunnelAtLaunch();
      await runTui(args);
      return;
    }

    if (args.startTarget === 'webui') {
      await ensureManagedN8nAtLaunch();
      await refreshN8nWorkspaceInstructionsAtLaunch();
      await ensureRelayAtLaunch();
      await ensureTunnelAtLaunch();
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
    await ensureManagedN8nAtLaunch();
    await refreshN8nWorkspaceInstructionsAtLaunch();
    await ensureRelayAtLaunch();
    await ensureTunnelAtLaunch();
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
    await ensureManagedN8nAtLaunch();
    await refreshN8nWorkspaceInstructionsAtLaunch();
    await ensureRelayAtLaunch();
    await ensureTunnelAtLaunch();
    await runWebUi(args, configService);
    return;
  }

  if (args.command === 'telegram-start') {
    await ensureManagedN8nAtLaunch();
    await refreshN8nWorkspaceInstructionsAtLaunch();
    await ensureRelayAtLaunch();
    await ensureTunnelAtLaunch();
    await runTelegramGateway({
      provider: args.provider,
      model: args.model,
      maxSteps: args.maxSteps,
    }, configService);
    return;
  }

  await ensureManagedN8nAtLaunch();
  await refreshN8nWorkspaceInstructionsAtLaunch();
  await ensureRelayAtLaunch();
  await ensureTunnelAtLaunch();

  const handle = await createYagrDeepAgent();
  const { runCliGateway } = await import('./gateway/cli.js');

  await runCliGateway(handle, {
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
