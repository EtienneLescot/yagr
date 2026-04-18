import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { resolveManagedN8nWorkflowOpen } from '../n8n-local/workflow-open.js';
import { getActiveWorkflowOpenTunnelState } from '../n8n-local/n8n-tunnel.js';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';

const DEFAULT_LOCAL_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_LOCAL_BRIDGE_PORT = 3791;

let serverPromise: Promise<void> | undefined;
let server: Server | undefined;
let activePort = DEFAULT_LOCAL_BRIDGE_PORT;
const targetByToken = new Map<string, string>();

function getOpenLinksDir(): string {
  ensureYagrHomeDir();
  return path.join(getYagrPaths().homeDir, 'open-links');
}

function getBridgeTargetsPath(): string {
  return path.join(getOpenLinksDir(), 'bridge-targets.json');
}

function readPersistedTargets(): Record<string, string> {
  try {
    const filePath = getBridgeTargetsPath();
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function persistTarget(token: string, targetUrl: string): void {
  try {
    const dir = getOpenLinksDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const next = {
      ...readPersistedTargets(),
      [token]: targetUrl,
    };
    fs.writeFileSync(getBridgeTargetsPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch {
    // best effort
  }
}

function buildWorkflowOpenToken(targetUrl: string): string {
  return createHash('sha256').update(targetUrl).digest('hex').slice(0, 16);
}

export function resolveStoredWorkflowOpenTarget(token: string): string {
  const inMemory = targetByToken.get(token);
  if (inMemory) {
    return inMemory;
  }

  const persisted = readPersistedTargets()[token];
  if (typeof persisted === 'string') {
    targetByToken.set(token, persisted);
    return persisted;
  }

  return '';
}

function registerWorkflowOpenTarget(targetUrl: string): string {
  const token = buildWorkflowOpenToken(targetUrl);
  targetByToken.set(token, targetUrl);
  persistTarget(token, targetUrl);
  return token;
}

export function decodeHtmlDataUrl(dataUrl: string): string {
  const encoded = dataUrl.split(',', 2)[1] ?? '';
  return decodeURIComponent(encoded);
}

export async function ensureLocalWorkflowOpenBridgeRunning(): Promise<void> {
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
        resolve();
      });
    };

    tryListen(DEFAULT_LOCAL_BRIDGE_PORT);
  });

  await serverPromise;
}

export function buildLocalWorkflowOpenBridgeUrl(target: string): string {
  const token = registerWorkflowOpenTarget(target);
  return `http://${DEFAULT_LOCAL_BRIDGE_HOST}:${activePort}/open/n8n-workflow/${token}`;
}

export function buildHostedWorkflowOpenBridgeUrl(baseUrl: string, target: string): string {
  const token = registerWorkflowOpenTarget(target);
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBaseUrl}/open/n8n-workflow/${token}`;
}

export function getLocalWorkflowOpenBridgeBaseUrl(): string {
  return `http://${DEFAULT_LOCAL_BRIDGE_HOST}:${activePort}`;
}

export function resolvePreferredWorkflowOpenBridgeUrl(target: string, fallbackBaseUrl?: string): string {
  const tunnelBaseUrl = getActiveWorkflowOpenTunnelState()?.tunnelUrl;
  if (tunnelBaseUrl) {
    return buildHostedWorkflowOpenBridgeUrl(tunnelBaseUrl, target);
  }

  if (fallbackBaseUrl) {
    return buildHostedWorkflowOpenBridgeUrl(fallbackBaseUrl, target);
  }

  return buildLocalWorkflowOpenBridgeUrl(target);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${DEFAULT_LOCAL_BRIDGE_HOST}:${activePort}`);

  if (method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('OK');
    return;
  }

  if (method !== 'GET' || !(url.pathname === '/open/n8n-workflow' || url.pathname.startsWith('/open/n8n-workflow/'))) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const token = url.pathname.startsWith('/open/n8n-workflow/')
    ? decodeURIComponent(url.pathname.slice('/open/n8n-workflow/'.length)).trim()
    : '';
  const target = String(token ? resolveStoredWorkflowOpenTarget(token) : (url.searchParams.get('target') ?? '')).trim();
  if (target.startsWith('data:text/html')) {
    const html = decodeHtmlDataUrl(target);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }

  const resolution = resolveManagedN8nWorkflowOpen(target);
  if (!resolution.ok) {
    response.writeHead(resolution.statusCode, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(resolution.error);
    return;
  }

  if (resolution.payload.mode === 'direct') {
    response.writeHead(302, { Location: resolution.payload.targetUrl });
    response.end();
    return;
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(resolution.payload.fallbackPage);
}
