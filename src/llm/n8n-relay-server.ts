/**
 * Local OpenAI-compatible HTTP relay server for n8n Chat Model nodes.
 *
 * n8n credentials of type openAiApi point to this server (baseUrl = http://127.0.0.1:PORT/v1).
 * Incoming requests are proxied to the currently active Yagr LLM provider, transparently
 * handling OAuth token refresh and other provider-specific auth.
 *
 * Constraint: Yagr must be running for workflows using the relay to function.
 */

import http from 'node:http';
import fs from 'node:fs';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
import { prepareProviderRuntime } from './proxy-runtime.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import type { YagrModelProvider } from './provider-registry.js';

export const N8N_RELAY_FAKE_API_KEY = 'yagr-relay-key';
const N8N_RELAY_DEFAULT_PORT = 11437;

export const N8N_RELAY_CREDENTIAL_NAME = 'Yagr LLM Proxy';

export interface N8nRelayServerState {
  port: number;
  pid: number;
  startedAt: string;
}

export interface N8nRelayInfo {
  port: number;
  baseUrl: string;
  apiKey: string;
}

let activeServer: http.Server | undefined;

export function getN8nRelayState(): N8nRelayServerState | undefined {
  try {
    const statePath = getYagrPaths().n8nRelayStatePath;
    if (!fs.existsSync(statePath)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as N8nRelayServerState;
  } catch {
    return undefined;
  }
}

function saveN8nRelayState(state: N8nRelayServerState): void {
  ensureYagrHomeDir();
  fs.writeFileSync(getYagrPaths().n8nRelayStatePath, JSON.stringify(state, null, 2));
}

function isRelayAlive(state: N8nRelayServerState): boolean {
  if (state.pid === process.pid) {
    return activeServer?.listening ?? false;
  }
  try {
    process.kill(state.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures the relay server is running. Starts it if needed. Returns connection info.
 */
export async function ensureN8nRelayServer(): Promise<N8nRelayInfo> {
  const existing = getN8nRelayState();
  if (existing && isRelayAlive(existing)) {
    return {
      port: existing.port,
      baseUrl: `http://127.0.0.1:${existing.port}/v1`,
      apiKey: N8N_RELAY_FAKE_API_KEY,
    };
  }

  const port = await startRelay();
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: N8N_RELAY_FAKE_API_KEY,
  };
}

async function attemptListen(server: http.Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('listening', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : port);
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1');
  });
}

async function startRelay(): Promise<number> {
  // Try fixed well-known port first, then fall back to OS-assigned port.
  for (const preferredPort of [N8N_RELAY_DEFAULT_PORT, 0]) {
    const server = http.createServer((req, res) => {
      void handleRequest(req, res);
    });

    let port: number;
    try {
      port = await attemptListen(server, preferredPort);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && preferredPort !== 0) {
        server.closeAllConnections?.();
        continue;
      }
      throw err;
    }

    activeServer = server;
    saveN8nRelayState({ port, pid: process.pid, startedAt: new Date().toISOString() });
    return port;
  }

  throw new Error('Failed to start n8n relay server: no available port');
}

async function resolveProviderRuntime() {
  const configService = new YagrConfigService();
  const config = configService.getLocalConfig();
  const provider = (config.provider ?? 'openai') as YagrModelProvider;
  const apiKey = configService.getApiKey(provider);
  const baseUrl = config.baseUrl;
  return prepareProviderRuntime(provider, { apiKey, baseUrl });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? '/';

  if (req.method === 'GET' && url === '/v1/models') {
    await handleModels(res);
    return;
  }

  if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/responses')) {
    await handleChatCompletions(req, res);
    return;
  }

  sendJson(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
}

async function handleModels(res: http.ServerResponse): Promise<void> {
  try {
    const result = await resolveProviderRuntime();
    const models = result.runtime?.models ?? [];
    sendJson(res, 200, {
      object: 'list',
      data: models.map((id) => ({ id, object: 'model', created: 0, owned_by: 'yagr' })),
    });
  } catch (err) {
    sendJson(res, 503, { error: { message: String(err), type: 'server_error' } });
  }
}

async function handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const result = await resolveProviderRuntime();

  if (!result.ready || !result.runtime) {
    sendJson(res, 503, {
      error: {
        message: result.reason ?? 'Yagr provider not ready. Make sure Yagr is configured and authenticated.',
        type: 'server_error',
      },
    });
    return;
  }

  const { baseUrl, apiKey } = result.runtime;

  if (!baseUrl) {
    sendJson(res, 503, {
      error: {
        message: 'Active provider does not expose an OpenAI-compatible base URL. Use a dedicated n8n credential for this provider instead.',
        type: 'server_error',
      },
    });
    return;
  }

  const body = await readBody(req);
  const targetUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const forwardHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    forwardHeaders['Authorization'] = `Bearer ${apiKey}`;
  }

  // Forward any provider-specific headers from the original request
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (lower.startsWith('openai-') || lower.startsWith('anthropic-') || lower.startsWith('x-')) {
      forwardHeaders[key] = String(value);
    }
  }

  const upstream = await fetch(targetUrl, {
    method: 'POST',
    headers: forwardHeaders,
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  });

  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
  });

  if (upstream.body) {
    for await (const chunk of upstream.body as AsyncIterable<Uint8Array>) {
      res.write(chunk);
    }
  }

  res.end();
}
