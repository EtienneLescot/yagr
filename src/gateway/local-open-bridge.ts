import { createHash } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolveManagedN8nWorkflowOpen } from '../n8n-local/workflow-open.js';

const DEFAULT_LOCAL_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_LOCAL_BRIDGE_PORT = 3791;

let serverPromise: Promise<void> | undefined;
let server: Server | undefined;
const targetByToken = new Map<string, string>();

export async function ensureLocalWorkflowOpenBridgeRunning(): Promise<void> {
  if (serverPromise) {
    await serverPromise;
    return;
  }

  serverPromise = new Promise<void>((resolve, reject) => {
    const nextServer = createServer((request, response) => {
      void handleRequest(request, response);
    });

    nextServer.once('error', (error) => {
      serverPromise = undefined;
      server = undefined;
      reject(error);
    });
    nextServer.listen(DEFAULT_LOCAL_BRIDGE_PORT, DEFAULT_LOCAL_BRIDGE_HOST, () => {
      server = nextServer;
      resolve();
    });
  });

  await serverPromise;
}

export function buildLocalWorkflowOpenBridgeUrl(targetUrl: string): string {
  const token = createHash('sha256').update(targetUrl).digest('hex').slice(0, 16);
  targetByToken.set(token, targetUrl);
  return `http://${DEFAULT_LOCAL_BRIDGE_HOST}:${DEFAULT_LOCAL_BRIDGE_PORT}/open/n8n-workflow/${token}`;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${DEFAULT_LOCAL_BRIDGE_HOST}:${DEFAULT_LOCAL_BRIDGE_PORT}`);

  if (method !== 'GET' || !(url.pathname === '/open/n8n-workflow' || url.pathname.startsWith('/open/n8n-workflow/'))) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const token = url.pathname.startsWith('/open/n8n-workflow/')
    ? decodeURIComponent(url.pathname.slice('/open/n8n-workflow/'.length)).trim()
    : '';
  const target = String(token ? (targetByToken.get(token) ?? '') : (url.searchParams.get('target') ?? '')).trim();
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
