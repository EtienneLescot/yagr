#!/usr/bin/env node
import './config/init-yagr-home.js';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { createYagrDeepAgent } from './agent-factory.js';
import { runCliGateway } from './gateway/cli.js';
import type { YagrModelProvider } from './llm/provider-registry.js';
import { getYagrSetupStatus, runYagrLlmSetup, runYagrSetup } from './setup.js';
import { YagrSetupApplicationService } from './setup/application-services.js';
import { isPidAlive, killProcessTree, spawnCommand, spawnDetached } from './system/process.js';
import { YAGR_SELECTABLE_MODEL_PROVIDERS } from './llm/provider-registry.js';
import { getProxyRuntimeStatus, listProxyRuntimeStatuses, startProviderProxy, stopProviderProxy } from './llm/proxy-runtime.js';
import {
  getDeepAgentSkillSourcePaths,
  installAgentSkills,
  listAgentSkills,
  removeAgentSkill,
  resolveAgentSkillRoots,
  type YagrSkillScope,
} from './skills/agent-skills.js';

const VALID_PROVIDERS: YagrModelProvider[] = [...YAGR_SELECTABLE_MODEL_PROVIDERS];

interface ParsedArgs {
  command?: 'help' | 'version' | 'config-show' | 'config-reset' | 'paths' | 'reset' | 'uninstall' | 'setup' | 'llm-setup' | 'start' | 'stop' | 'restart' | 'tui' | 'webui' | 'gateway' | 'gateway-start' | 'gateway-worker' | 'gateway-status' | 'telegram-setup' | 'telegram-start' | 'telegram-status' | 'telegram-reset' | 'telegram-onboarding' | 'proxy-start' | 'proxy-status' | 'proxy-stop' | 'skills-list' | 'skills-install' | 'skills-remove' | 'skills-path';
  startTarget?: 'webui' | 'tui';
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
  skillScope?: YagrSkillScope;
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

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    parsed.command = 'help';
    return parsed;
  }
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === '-V') {
    parsed.command = 'version';
    return parsed;
  }

  let startIndex = 0;
  const [a, b] = argv;
  if (a === 'config' && b === 'show') return { ...parsed, command: 'config-show' };
  if (a === 'config' && b === 'reset') return { ...parsed, command: 'config-reset' };
  if (a === 'paths') return { ...parsed, command: 'paths' };
  if (a === 'stop') return { ...parsed, command: 'stop' };
  if (a === 'tui') return { ...parsed, command: 'tui' };
  if (a === 'webui') return { ...parsed, command: 'webui' };
  if (a === 'setup' || a === 'onboard') { parsed.command = 'setup'; startIndex = 1; }
  if (a === 'llm' && b === 'setup') { parsed.command = 'llm-setup'; startIndex = 2; }
  if (a === 'start') { parsed.command = 'start'; startIndex = 1; }
  if (a === 'restart') { parsed.command = 'restart'; startIndex = 1; }
  if (a === 'reset') { parsed.command = 'reset'; startIndex = 1; }
  if (a === 'uninstall') { parsed.command = 'uninstall'; startIndex = 1; }
  if (a === 'gateway' && !b) { parsed.command = 'gateway'; startIndex = 1; }
  if (a === 'gateway' && b === 'start') { parsed.command = 'gateway-start'; startIndex = 2; }
  if (a === 'gateway' && b === 'worker') { parsed.command = 'gateway-worker'; startIndex = 2; }
  if (a === 'gateway' && b === 'status') return { ...parsed, command: 'gateway-status' };
  if (a === 'telegram' && b === 'setup') { parsed.command = 'telegram-setup'; startIndex = 2; }
  if (a === 'telegram' && b === 'start') { parsed.command = 'telegram-start'; startIndex = 2; }
  if (a === 'telegram' && b === 'status') return { ...parsed, command: 'telegram-status' };
  if (a === 'telegram' && (b === 'onboarding' || b === 'link')) return { ...parsed, command: 'telegram-onboarding' };
  if (a === 'telegram' && b === 'reset') return { ...parsed, command: 'telegram-reset' };
  if (a === 'proxy' && b === 'start') { parsed.command = 'proxy-start'; startIndex = 2; }
  if (a === 'proxy' && b === 'status') { parsed.command = 'proxy-status'; startIndex = 2; }
  if (a === 'proxy' && b === 'stop') { parsed.command = 'proxy-stop'; startIndex = 2; }
  if (a === 'skills' && b === 'list') { parsed.command = 'skills-list'; startIndex = 2; }
  if (a === 'skills' && b === 'install') { parsed.command = 'skills-install'; startIndex = 2; }
  if (a === 'skills' && b === 'remove') { parsed.command = 'skills-remove'; startIndex = 2; }
  if (a === 'skills' && b === 'path') { parsed.command = 'skills-path'; startIndex = 2; }
  if (a === 'skills' && !parsed.command) throw new Error(`Unknown skills command: ${b ?? ''}`);

  const rest: string[] = [];
  for (let i = startIndex; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--interactive' || arg === '-i') parsed.interactive = true;
    else if (arg === '--hide-thinking') parsed.showThinking = false;
    else if (arg === '--hide-execution') parsed.showExecution = false;
    else if (arg === '--debug') parsed.debug = true;
    else if (arg === '--yes') parsed.yes = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--provider') parsed.provider = parseProvider(argv[++i]);
    else if (arg === '--model') parsed.model = argv[++i];
    else if (arg === '--max-steps') parsed.maxSteps = Number(argv[++i]);
    else if (arg === '--scope') {
      const value = argv[++i];
      if (parsed.command?.startsWith('skills-')) parsed.skillScope = parseSkillScope(value);
      else parsed.resetScope = parseResetScope(value);
    }
    else if (arg === '--workspace') parsed.skillScope = 'workspace';
    else if (!parsed.command && arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else rest.push(arg);
  }

  if (!parsed.command) {
    parsed.prompt = argv.join(' ').trim();
  } else if (rest.length > 0) {
    if ((parsed.command === 'start' || parsed.command === 'restart') && (rest[0] === 'webui' || rest[0] === 'web')) parsed.startTarget = 'webui';
    else if ((parsed.command === 'start' || parsed.command === 'restart') && (rest[0] === 'tui' || rest[0] === 'terminal')) parsed.startTarget = 'tui';
    else parsed.prompt = rest.join(' ').trim();
  }

  return parsed;
}

function parseProvider(value: string | undefined): YagrModelProvider {
  if (!value || !VALID_PROVIDERS.includes(value as YagrModelProvider)) {
    throw new Error(`Unknown provider: ${value ?? ''}`);
  }
  return value as YagrModelProvider;
}

function parseResetScope(value: string | undefined): YagrResetScope {
  if (value === 'config' || value === 'config+creds' || value === 'full') return value;
  throw new Error(`Unknown reset scope: ${value ?? ''}`);
}

function parseSkillScope(value: string | undefined): YagrSkillScope {
  if (value === 'global' || value === 'workspace') return value;
  throw new Error(`Unknown skill scope: ${value ?? ''}`);
}

export function getGatewayRestartDelayMs(failureCount: number): number {
  const cappedFailures = Math.max(0, Math.min(failureCount, 6));
  return Math.min(300_000, 60_000 * (2 ** cappedFailures));
}

function printHelp(): void {
  process.stdout.write(`Yagr - autonomous local coding agent\n\nUsage:\n  yagr <prompt> [options]\n  yagr start [tui|webui] [options]\n  yagr setup\n  yagr llm setup\n\nCommands:\n  setup                      Configure local coding-agent runtime\n  llm setup                  Configure the language model\n  start [tui|webui]          Start configured gateway surfaces\n  tui                        Start terminal UI\n  webui                      Start Web UI\n  gateway start              Start configured gateway surfaces\n  gateway status             Show gateway status\n  telegram setup             Configure Telegram gateway\n  telegram start             Start Telegram gateway\n  telegram status            Show Telegram gateway status\n  telegram onboarding        Show Telegram onboarding link\n  telegram reset             Remove Telegram configuration\n  proxy start <provider>     Start an account-backed provider proxy\n  proxy status [provider]    Show provider proxy status\n  proxy stop <provider>      Stop provider proxy\n  skills list                List installed Agent Skills\n  skills install <source>    Install Agent Skills from a local or remote source\n  skills remove <name>       Remove an installed Agent Skill\n  skills path                Print Agent Skills source paths\n  config show                Print local config\n  config reset               Remove local config and credentials\n  paths                      Print Yagr paths\n  reset [--scope <scope>]    Reset Yagr local state\n  uninstall                  Full local reset\n\nOptions:\n  --provider <name>          AI provider: ${VALID_PROVIDERS.join(', ')}\n  --model <name>             Model name to use\n  --max-steps <n>            Maximum number of agent steps\n  --interactive, -i          Keep the session open after the prompt\n  --hide-thinking            Hide agent thinking output\n  --hide-execution           Hide tool execution output\n  --yes                      Auto-confirm destructive operations\n  --dry-run                  Preview reset without changes\n  --scope <scope>            Scope for reset or skills: global, workspace\n  --workspace                Install/remove skills in the workspace scope\n  --version, -v              Print version\n  --help, -h                 Show this help\n`);
}

function printVersion(): void {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { version?: string };
  process.stdout.write(`${pkg.version ?? '0.0.0'}\n`);
}

function printPaths(): void {
  process.stdout.write(`${JSON.stringify(getYagrPaths(), null, 2)}\n`);
}

function printConfig(configService: YagrConfigService): void {
  process.stdout.write(`${JSON.stringify(configService.getLocalConfig(), null, 2)}\n`);
}

async function runPrompt(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  if (!args.prompt) {
    throw new Error('Prompt is required.');
  }
  const handle = await createYagrDeepAgent(configService, undefined, undefined, {
    provider: args.provider,
    model: args.model,
    maxSteps: args.maxSteps,
    display: {
      showThinking: args.showThinking,
      showExecution: args.showExecution,
    },
  });
  await runCliGateway(handle, { prompt: args.prompt, interactive: args.interactive });
}

async function runStart(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  if (args.startTarget === 'webui') {
    await runGatewaySurfaces(['webui'], {
      provider: args.provider,
      model: args.model,
      maxSteps: args.maxSteps,
    }, configService);
    return;
  }
  if (args.startTarget === 'tui') {
    await runCliGateway(await createYagrDeepAgent(configService, undefined, undefined, {
      provider: args.provider,
      model: args.model,
      maxSteps: args.maxSteps,
    }), { interactive: true });
    return;
  }
  await runGatewaySupervisor(args, configService);
}

async function runTui(args: ParsedArgs, configService: YagrConfigService): Promise<void> {
  await runCliGateway(await createYagrDeepAgent(configService, undefined, undefined, {
    provider: args.provider,
    model: args.model,
    maxSteps: args.maxSteps,
  }), { interactive: true });
}

async function runReset(scope: YagrResetScope, dryRun: boolean): Promise<void> {
  const result = await resetYagrLocalState(scope, { dryRun });
  process.stdout.write(`${dryRun ? 'Would remove' : 'Removed'}:\n${result.removedPaths.map((p) => `- ${p}`).join('\n')}\n`);
}

async function runProxyCommand(args: ParsedArgs): Promise<void> {
  const provider = args.prompt ? parseProvider(args.prompt.split(/\s+/)[0]) : args.provider;
  if (args.command === 'proxy-status') {
    const statuses = provider ? [getProxyRuntimeStatus(provider)] : listProxyRuntimeStatuses();
    process.stdout.write(`${JSON.stringify(statuses, null, 2)}\n`);
    return;
  }
  if (!provider) {
    throw new Error('Provider is required.');
  }
  if (args.command === 'proxy-start') {
    const runtime = await startProviderProxy(provider);
    process.stdout.write(`${JSON.stringify(runtime, null, 2)}\n`);
    return;
  }
  if (args.command === 'proxy-stop') {
    await stopProviderProxy(provider);
    process.stdout.write(`Stopped ${provider} proxy.\n`);
  }
}

async function runSkillsCommand(args: ParsedArgs): Promise<void> {
  if (args.command === 'skills-list') {
    process.stdout.write(`${JSON.stringify(listAgentSkills(), null, 2)}\n`);
    return;
  }
  if (args.command === 'skills-path') {
    process.stdout.write(`${JSON.stringify({
      roots: resolveAgentSkillRoots(),
      deepAgentSkillSourcePaths: getDeepAgentSkillSourcePaths({ includeEmpty: true }),
      activeDeepAgentSkillSourcePaths: getDeepAgentSkillSourcePaths(),
    }, null, 2)}\n`);
    return;
  }
  if (args.command === 'skills-install') {
    if (!args.prompt) throw new Error('Skill source is required.');
    const installed = await installAgentSkills(args.prompt, { scope: args.skillScope ?? 'global' });
    process.stdout.write(`${JSON.stringify(installed, null, 2)}\n`);
    return;
  }
  if (args.command === 'skills-remove') {
    if (!args.prompt) throw new Error('Skill name is required.');
    const result = await removeAgentSkill(args.prompt, { scope: args.skillScope ?? 'global' });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configService = new YagrConfigService();

  switch (args.command) {
    case 'help': printHelp(); return;
    case 'version': printVersion(); return;
    case 'paths': printPaths(); return;
    case 'config-show': printConfig(configService); return;
    case 'config-reset': await runReset('config+creds', false); return;
    case 'reset': await runReset(args.resetScope ?? 'config+creds', args.dryRun); return;
    case 'uninstall': await runReset('full', args.dryRun); return;
    case 'setup': await runYagrSetup(configService); return;
    case 'llm-setup': await runYagrLlmSetup(configService); return;
    case 'start': case 'restart': await runStart(args, configService); return;
    case 'tui': await runTui(args, configService); return;
    case 'webui': await runGatewaySurfaces(['webui'], args, configService); return;
    case 'gateway': case 'gateway-start': await runGatewaySupervisor(args, configService); return;
    case 'gateway-worker': await runGatewaySupervisor(args, configService); return;
    case 'gateway-status': process.stdout.write(`${getGatewayRunningBanner(configService)}\n`); return;
    case 'telegram-setup': await setupTelegramGateway(configService); return;
    case 'telegram-start': await runTelegramGateway(args, configService); return;
    case 'telegram-status': process.stdout.write(`${JSON.stringify(getTelegramGatewayStatus(configService), null, 2)}\n`); return;
    case 'telegram-onboarding': showTelegramOnboarding(configService); return;
    case 'telegram-reset': resetTelegramGateway(configService); return;
    case 'proxy-start': case 'proxy-status': case 'proxy-stop': await runProxyCommand(args); return;
    case 'skills-list': case 'skills-install': case 'skills-remove': case 'skills-path': await runSkillsCommand(args); return;
    case 'stop': return;
    default: await runPrompt(args, configService); return;
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
