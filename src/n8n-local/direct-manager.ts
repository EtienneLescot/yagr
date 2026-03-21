import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { DEFAULT_N8N_PORT, inspectLocalN8nBootstrap } from './detect.js';
import {
  buildManagedN8nState,
  ensureManagedN8nDirs,
  readManagedN8nState,
  updateManagedN8nState,
  type ManagedN8nInstanceState,
} from './state.js';

const DEFAULT_HEALTH_TIMEOUT_MS = 180_000;
const DEFAULT_EDITOR_TIMEOUT_MS = 90_000;
const N8N_PACKAGE_SPEC = 'n8n@latest';

export async function installManagedDirectN8n(options: { port?: number } = {}): Promise<ManagedN8nInstanceState> {
  const assessment = await inspectLocalN8nBootstrap();
  if (!assessment.node.supportedForDirectRuntime) {
    throw new Error('A supported local Node.js runtime is required for direct n8n bootstrap. Run `yagr n8n doctor` for details.');
  }

  const paths = ensureManagedN8nDirs();
  const existingState = readManagedN8nState();
  const port = options.port ?? existingState?.port ?? assessment.preferredPort ?? DEFAULT_N8N_PORT;
  const state = updateManagedN8nState(() => buildManagedN8nState({
    strategy: 'direct',
    image: '',
    port,
    status: 'starting',
    bootstrapStage: 'owner-pending',
    logFile: paths.logFile,
  }));

  const child = spawn('npm', [
    'exec',
    '--yes',
    N8N_PACKAGE_SPEC,
    '--',
    'start',
  ], {
    cwd: paths.rootDir,
    detached: true,
    stdio: ['ignore', fs.openSync(paths.logFile, 'a'), fs.openSync(paths.logFile, 'a')],
    env: {
      ...process.env,
      N8N_PORT: String(port),
      N8N_HOST: '127.0.0.1',
      N8N_LISTEN_ADDRESS: '0.0.0.0',
      N8N_PROTOCOL: 'http',
      N8N_EDITOR_BASE_URL: `http://127.0.0.1:${port}`,
      N8N_SECURE_COOKIE: 'false',
      N8N_USER_FOLDER: paths.dataDir,
      N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'true',
      GENERIC_TIMEZONE: 'UTC',
      TZ: 'UTC',
    },
  });

  child.unref();

  await waitForManagedN8nHealth(state.url);
  await waitForManagedN8nEditorReadyBestEffort(state.url);

  return updateManagedN8nState((current) => ({
    ...(current ?? state),
    strategy: 'direct',
    port,
    url: state.url,
    logFile: paths.logFile,
    pid: child.pid,
    status: 'ready',
    bootstrapStage: 'owner-pending',
    lastError: undefined,
  }));
}

export async function startManagedDirectN8n(): Promise<ManagedN8nInstanceState> {
  const state = readManagedN8nState();
  if (!state || state.strategy !== 'direct') {
    throw new Error('No Yagr-managed direct local n8n instance is installed yet. Run `yagr n8n local install` first.');
  }

  return installManagedDirectN8n({ port: state.port });
}

export async function stopManagedDirectN8n(): Promise<ManagedN8nInstanceState> {
  const state = readManagedN8nState();
  if (!state || state.strategy !== 'direct') {
    throw new Error('No Yagr-managed direct local n8n instance is installed yet.');
  }

  if (state.pid) {
    try {
      process.kill(state.pid, 'SIGTERM');
    } catch {
      // ignore missing process
    }
  }

  return updateManagedN8nState((current) => ({
    ...(current ?? state),
    status: 'stopped',
    lastError: undefined,
  }));
}

export async function getManagedDirectN8nLogs(): Promise<string> {
  const state = readManagedN8nState();
  if (!state?.logFile || !fs.existsSync(state.logFile)) {
    return '';
  }

  return fs.readFileSync(state.logFile, 'utf-8');
}

async function isManagedN8nHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

async function isManagedN8nEditorReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return false;
    }

    const body = await response.text();
    return body.trim().length > 0 && !body.toLowerCase().includes('n8n is starting up');
  } catch {
    return false;
  }
}

async function waitForManagedN8nHealth(url: string, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isManagedN8nHealthy(url)) {
      return;
    }
    await delay(1500);
  }

  throw new Error(`Timed out waiting for ${url} to become healthy.`);
}

async function waitForManagedN8nEditorReady(url: string, timeoutMs = DEFAULT_EDITOR_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isManagedN8nEditorReady(url)) {
      return;
    }
    await delay(1500);
  }

  throw new Error(`Timed out waiting for the n8n editor at ${url} to become ready.`);
}

async function waitForManagedN8nEditorReadyBestEffort(url: string): Promise<void> {
  try {
    await waitForManagedN8nEditorReady(url);
  } catch {
    // best effort only
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
