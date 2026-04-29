import fs from 'node:fs';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
import { isPidAlive, killProcessTree, spawnDetached } from '../system/process.js';

const DEFAULT_LOCAL_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_LOCAL_BRIDGE_PORT = 3791;
const LOCAL_OPEN_BRIDGE_START_TIMEOUT_MS = 8_000;

let serverPromise: Promise<void> | undefined;
let server: Server | undefined;
let activePort = DEFAULT_LOCAL_BRIDGE_PORT;

export interface LocalOpenBridgeState {
  port: number;
  pid: number;
  startedAt: string;
}

function getLocalOpenBridgeStatePath(): string {
  return getYagrPaths().localOpenBridgeStatePath;
}

function readLocalOpenBridgeState(): LocalOpenBridgeState | undefined {
  try {
    const statePath = getLocalOpenBridgeStatePath();
    if (!fs.existsSync(statePath)) {
      return undefined;
    }
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<LocalOpenBridgeState>;
    if (typeof parsed.port !== 'number' || typeof parsed.pid !== 'number' || typeof parsed.startedAt !== 'string') {
      return undefined;
    }
    return {
      port: parsed.port,
      pid: parsed.pid,
      startedAt: parsed.startedAt,
    };
  } catch {
    return undefined;
  }
}

function saveLocalOpenBridgeState(state: LocalOpenBridgeState): void {
  ensureYagrHomeDir();
  fs.writeFileSync(getLocalOpenBridgeStatePath(), JSON.stringify(state, null, 2));
}

function clearLocalOpenBridgeState(): void {
  try {
    fs.unlinkSync(getLocalOpenBridgeStatePath());
  } catch {
    // already gone
  }
}

function isLocalOpenBridgeAlive(state: LocalOpenBridgeState): boolean {
  if (state.pid === process.pid) {
    return server?.listening ?? false;
  }
  return isPidAlive(state.pid);
}

function getActiveLocalOpenBridgeState(): LocalOpenBridgeState | undefined {
  const state = readLocalOpenBridgeState();
  if (!state) {
    return undefined;
  }
  if (!isLocalOpenBridgeAlive(state)) {
    clearLocalOpenBridgeState();
    return undefined;
  }
  activePort = state.port;
  return state;
}

export async function ensureLocalN8nAuthBridgeRunning(): Promise<void> {
  const existing = getActiveLocalOpenBridgeState();
  if (existing) {
    activePort = existing.port;
    return;
  }

  spawnLocalOpenBridgeProcess();
  const state = await waitForLocalOpenBridgeState(LOCAL_OPEN_BRIDGE_START_TIMEOUT_MS);
  activePort = state.port;
}

function spawnLocalOpenBridgeProcess(): void {
  ensureYagrHomeDir();
  const paths = getYagrPaths();
  const logDir = path.join(paths.proxyRuntimeDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'local-open-bridge.log');
  const logFd = fs.openSync(logPath, 'a');

  const entrypoint = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'local-open-bridge-entrypoint.js',
  );

  const child = spawnDetached(process.execPath, [entrypoint], {
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  fs.closeSync(logFd);
}

async function waitForLocalOpenBridgeState(timeoutMs: number): Promise<LocalOpenBridgeState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = getActiveLocalOpenBridgeState();
    if (state) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Local n8n auth bridge did not start within ${timeoutMs}ms. Check ~/.yagr/proxy-runtime/logs/local-open-bridge.log`);
}

export async function ensureLocalN8nAuthBridgeRunningInProcess(): Promise<void> {
  const existing = getActiveLocalOpenBridgeState();
  if (existing && existing.pid !== process.pid) {
    activePort = existing.port;
    return;
  }

  if (serverPromise) {
    await serverPromise;
    return;
  }

  serverPromise = new Promise<void>((resolve, reject) => {
    const tryListen = (preferredPort: number) => {
      const nextServer = createServer((request, response) => {
        void handleRequest(request, response);
      });

      nextServer.once('error', (error) => {
        server = undefined;
        if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && preferredPort !== 0) {
          tryListen(0);
          return;
        }
        serverPromise = undefined;
        reject(error);
      });

      nextServer.listen(preferredPort, DEFAULT_LOCAL_BRIDGE_HOST, () => {
        const address = nextServer.address();
        activePort = typeof address === 'object' && address ? address.port : preferredPort;
        server = nextServer;
        saveLocalOpenBridgeState({
          port: activePort,
          pid: process.pid,
          startedAt: new Date().toISOString(),
        });
        resolve();
      });
    };

    tryListen(DEFAULT_LOCAL_BRIDGE_PORT);
  });

  await serverPromise;
}

export async function stopLocalN8nAuthBridge(): Promise<void> {
  const state = readLocalOpenBridgeState();
  if (!state) {
    return;
  }

  if (state.pid === process.pid) {
    if (server) {
      const currentServer = server;
      server = undefined;
      serverPromise = undefined;
      await new Promise<void>((resolve, reject) => {
        currentServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    clearLocalOpenBridgeState();
    return;
  }

  await killProcessTree(state.pid);

  const start = Date.now();
  while (isPidAlive(state.pid) && Date.now() - start < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (isPidAlive(state.pid)) {
    await killProcessTree(state.pid, { force: true });
  }
  clearLocalOpenBridgeState();
}

export function getLocalN8nAuthBridgeBaseUrl(): string {
  const state = getActiveLocalOpenBridgeState();
  if (state) {
    return `http://${DEFAULT_LOCAL_BRIDGE_HOST}:${state.port}`;
  }
  return `http://${DEFAULT_LOCAL_BRIDGE_HOST}:${activePort}`;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${DEFAULT_LOCAL_BRIDGE_HOST}:${activePort}`);

  if (method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('OK');
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}
