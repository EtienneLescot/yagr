import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
import { ensureOpenAiAccountSession, OPENAI_ACCOUNT_BASE_URL, OPENAI_ACCOUNT_MODEL_CATALOG } from './openai-account.js';
import { fetchAvailableModels } from './provider-discovery.js';
import { getDefaultBaseUrlForProvider, getProviderDefinition, type YagrModelProvider } from './provider-registry.js';

interface ProxyRuntimeEntry {
  provider: YagrModelProvider;
  pid?: number;
  command: string;
  baseUrl: string;
  logPath: string;
  startedAt: string;
}

interface ProxyRuntimeState {
  providers?: Partial<Record<YagrModelProvider, ProxyRuntimeEntry>>;
}

export interface PreparedProviderRuntime {
  provider: YagrModelProvider;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  notes: string[];
  logPath?: string;
  autoStarted: boolean;
}

export interface PrepareProviderRuntimeResult {
  ready: boolean;
  runtime?: PreparedProviderRuntime;
  reason?: string;
  notes: string[];
}

export interface ProxyRuntimeStatus {
  provider: YagrModelProvider;
  configuredBaseUrl?: string;
  running: boolean;
  pid?: number;
  command?: string;
  logPath?: string;
  startedAt?: string;
  managed: boolean;
}

export async function prepareProviderRuntime(
  provider: YagrModelProvider,
  options: { apiKey?: string; baseUrl?: string } = {},
): Promise<PrepareProviderRuntimeResult> {
  if (provider === 'openai-proxy') {
    const session = await ensureOpenAiAccountSession();
    if (!session) {
      return {
        ready: false,
        reason: 'Unable to sign in to ChatGPT via Codex. Run `codex --login` and retry.',
        notes: ['OpenAI account login is handled through the local Codex CLI session.'],
      };
    }

    return {
      ready: true,
      runtime: {
        provider,
        baseUrl: OPENAI_ACCOUNT_BASE_URL,
        apiKey: session.accessToken,
        models: [...OPENAI_ACCOUNT_MODEL_CATALOG],
        notes: ['Connected through the local Codex ChatGPT session.'],
        autoStarted: false,
      },
      notes: ['Connected through the local Codex ChatGPT session.'],
    };
  }

  const definition = getProviderDefinition(provider);
  const baseUrl = options.baseUrl || getDefaultBaseUrlForProvider(provider);
  if (!definition.usesOpenAiCompatibleApi || !baseUrl) {
    return {
      ready: false,
      notes: [],
    };
  }

  const existingModels = await fetchAvailableModels(provider, options.apiKey, baseUrl);
  if (existingModels.length > 0) {
    return {
      ready: true,
      runtime: {
        provider,
        baseUrl,
        apiKey: options.apiKey,
        models: existingModels,
        notes: [],
        autoStarted: false,
      },
      notes: [],
    };
  }

  if (!definition.managedProxy) {
    return {
      ready: false,
      notes: [],
    };
  }

  const stateEntry = getRuntimeState().providers?.[provider];
  if (stateEntry?.pid && isProcessRunning(stateEntry.pid)) {
    const runningModels = await waitForModels(provider, options.apiKey, stateEntry.baseUrl, definition.managedProxy.readyTimeoutMs ?? 30_000);
    if (runningModels.length > 0) {
      return {
        ready: true,
        runtime: {
          provider,
          baseUrl: stateEntry.baseUrl,
          apiKey: options.apiKey,
          models: runningModels,
          notes: definition.managedProxy.startupNotes ?? [],
          logPath: stateEntry.logPath,
          autoStarted: false,
        },
        notes: definition.managedProxy.startupNotes ?? [],
      };
    }
  }

  const started = startManagedProxy(provider, baseUrl);
  const models = await waitForModels(provider, options.apiKey, started.baseUrl, definition.managedProxy.readyTimeoutMs ?? 30_000);
  if (models.length > 0) {
    return {
      ready: true,
      runtime: {
        provider,
        baseUrl: started.baseUrl,
        apiKey: options.apiKey,
        models,
        notes: definition.managedProxy.startupNotes ?? [],
        logPath: started.logPath,
        autoStarted: true,
      },
      notes: definition.managedProxy.startupNotes ?? [],
    };
  }

  return {
    ready: false,
    reason: `Managed proxy for ${provider} did not become ready. Check ${started.logPath}.`,
    notes: [
      ...(definition.managedProxy.startupNotes ?? []),
      `Proxy logs: ${started.logPath}`,
    ],
  };
}

function startManagedProxy(provider: YagrModelProvider, baseUrl: string): ProxyRuntimeEntry {
  const definition = getProviderDefinition(provider);
  const managed = definition.managedProxy;
  if (!managed) {
    throw new Error(`Provider ${provider} does not have a managed proxy runtime.`);
  }

  ensureYagrHomeDir();
  const paths = getYagrPaths();
  const logDir = path.join(paths.proxyRuntimeDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${provider}.log`);
  const logFd = fs.openSync(logPath, 'a');
  const args = ['--yes', '--package', managed.packageName, managed.executable, ...(managed.args ?? [])];
  const child = spawn('npx', args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });

  child.unref();
  fs.closeSync(logFd);

  const entry: ProxyRuntimeEntry = {
    provider,
    pid: child.pid,
    command: `npx ${args.join(' ')}`,
    baseUrl,
    logPath,
    startedAt: new Date().toISOString(),
  };
  updateRuntimeState((state) => ({
    ...state,
    providers: {
      ...(state.providers ?? {}),
      [provider]: entry,
    },
  }));
  return entry;
}

export function startProviderProxy(provider: YagrModelProvider, options: { baseUrl?: string } = {}): ProxyRuntimeStatus {
  const definition = getProviderDefinition(provider);
  if (!definition.managedProxy) {
    throw new Error(`Provider ${provider} does not have a managed proxy runtime yet.`);
  }

  const baseUrl = options.baseUrl || getDefaultBaseUrlForProvider(provider);
  if (!baseUrl) {
    throw new Error(`Provider ${provider} does not define a default proxy base URL.`);
  }

  const existing = getProxyRuntimeStatus(provider);
  if (existing.running) {
    return existing;
  }

  const entry = startManagedProxy(provider, baseUrl);
  return {
    provider,
    configuredBaseUrl: entry.baseUrl,
    running: true,
    pid: entry.pid,
    command: entry.command,
    logPath: entry.logPath,
    startedAt: entry.startedAt,
    managed: true,
  };
}

export function stopProviderProxy(provider: YagrModelProvider): ProxyRuntimeStatus {
  const currentState = getRuntimeState();
  const entry = currentState.providers?.[provider];
  if (entry?.pid && isProcessRunning(entry.pid)) {
    process.kill(entry.pid, 'SIGTERM');
  }

  updateRuntimeState((state) => ({
    ...state,
    providers: {
      ...(state.providers ?? {}),
      [provider]: undefined,
    },
  }));

  return getProxyRuntimeStatus(provider);
}

export function getProxyRuntimeStatus(provider: YagrModelProvider): ProxyRuntimeStatus {
  const definition = getProviderDefinition(provider);
  const entry = getRuntimeState().providers?.[provider];
  return {
    provider,
    configuredBaseUrl: entry?.baseUrl || getDefaultBaseUrlForProvider(provider),
    running: Boolean(entry?.pid && isProcessRunning(entry.pid)),
    pid: entry?.pid,
    command: entry?.command,
    logPath: entry?.logPath,
    startedAt: entry?.startedAt,
    managed: Boolean(definition.managedProxy),
  };
}

export function listProxyRuntimeStatuses(): ProxyRuntimeStatus[] {
  return (Object.keys(getRuntimeState().providers ?? {}) as YagrModelProvider[]).map((provider) =>
    getProxyRuntimeStatus(provider),
  );
}

async function waitForModels(
  provider: YagrModelProvider,
  apiKey: string | undefined,
  baseUrl: string,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const models = await fetchAvailableModels(provider, apiKey, baseUrl);
    if (models.length > 0) {
      return models;
    }
    await delay(1_000);
  }
  return [];
}

function getRuntimeState(): ProxyRuntimeState {
  const paths = getYagrPaths();
  if (!fs.existsSync(paths.proxyRuntimeStatePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(paths.proxyRuntimeStatePath, 'utf-8')) as ProxyRuntimeState;
  } catch {
    return {};
  }
}

function updateRuntimeState(updater: (current: ProxyRuntimeState) => ProxyRuntimeState): void {
  const paths = getYagrPaths();
  fs.mkdirSync(paths.proxyRuntimeDir, { recursive: true });
  fs.writeFileSync(paths.proxyRuntimeStatePath, JSON.stringify(updater(getRuntimeState()), null, 2));
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
