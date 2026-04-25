/**
 * Local OpenAI-compatible HTTP relay server for n8n Chat Model nodes.
 *
 * n8n credentials of type openAiApi point to this server at the configured baseUrl.
 * Incoming requests are proxied to the currently active Yagr LLM provider, transparently
 * handling OAuth token refresh and other provider-specific auth.
 *
 * Architecture: the relay runs as a detached child process that outlives the agent session.
 * `ensureN8nRelayServer()` spawns that process if not already running.
 * `ensureN8nRelayServerInProcess()` is the entrypoint called inside the child process.
 *
 * Binding: always 0.0.0.0 so Docker containers can reach it via the host bridge address.
 */

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
import { prepareProviderRuntime } from './proxy-runtime.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import type { YagrModelProvider } from './provider-registry.js';
import { handleAnthropicRelay } from './anthropic-relay.js';
import { handleOpenAiAccountRelay } from './openai-account-relay.js';
import { resolveLanguageModelConfig } from './create-langchain-model.js';
import { translateChatCompletionToResponsesApi, pipeChatCompletionsSseAsResponsesApi } from './responses-api-relay.js';
import { isPidAlive, killProcessTree, spawnCommand, spawnDetached } from '../system/process.js';

/**
 * Providers that natively support the OpenAI Responses API (/v1/responses).
 * All others use a round-trip translation (Responses ↔ chat completions).
 */
const PROVIDERS_WITH_NATIVE_RESPONSES_API = new Set<string>(['openai', 'openrouter']);

export const YAGR_LLM_RELAY_HOST_ENV = 'YAGR_LLM_RELAY_HOST';

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
  /** Base URL to use in the n8n credential (may be docker host IP or tunnel URL) */
  baseUrl: string;
  /** Base URL reachable from the local host machine */
  hostBaseUrl: string;
  apiKey: string;
}

interface ResponsesApiRequest {
  model?: string;
  instructions?: string;
  input?: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  stream?: boolean;
  max_output_tokens?: number;
}

let activeServer: http.Server | undefined;

function normalizeDockerRelayHost(host: string | undefined, platform: NodeJS.Platform = process.platform): string | undefined {
  if (!host) {
    return host;
  }

  const prefersDockerDesktopHost = platform === 'win32' || platform === 'darwin';
  const isBridgeIp = /^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== '127.0.0.1';
  if (prefersDockerDesktopHost && isBridgeIp) {
    return 'host.docker.internal';
  }

  return host;
}

// ─── State persistence ────────────────────────────────────────────────────────

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
  return isPidAlive(state.pid);
}

// ─── Docker host address detection ───────────────────────────────────────────

/**
 * Resolve the address that Docker containers should use to reach this host.
 * Priority:
 *   1. YAGR_N8N_RELAY_HOST env override
 *   2. host.docker.internal on Docker Desktop platforms
 *   3. host.docker.internal when resolvable from the current runtime
 *   4. docker0 bridge IP from network interfaces
 *   5. docker network inspect bridge gateway
 *   6. Fallback: 127.0.0.1
 */
export async function resolveDockerHostAddress(platform: NodeJS.Platform = process.platform): Promise<string> {
  const override = process.env[YAGR_LLM_RELAY_HOST_ENV]?.trim() ?? process.env['YAGR_N8N_RELAY_HOST']?.trim();
  if (override) {
    return override;
  }

  // Docker Desktop guarantees this hostname inside containers even if the host
  // runtime itself does not resolve it via DNS.
  if (platform === 'win32' || platform === 'darwin') {
    return 'host.docker.internal';
  }

  // Try host.docker.internal when the current runtime can resolve it.
  try {
    const { Resolver } = await import('node:dns/promises');
    const resolver = new Resolver();
    const addrs = await resolver.resolve4('host.docker.internal');
    if (addrs.length > 0) {
      return 'host.docker.internal';
    }
  } catch {
    // not resolvable
  }

  // Try docker0 from network interfaces
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    if (!/docker/i.test(name)) continue;
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  // Try docker network inspect
  try {
    const ip = await getDockerBridgeGateway();
    if (ip) return ip;
  } catch {
    // docker not available
  }

  return '127.0.0.1';
}

function getDockerBridgeGateway(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawnCommand('docker', ['network', 'inspect', 'bridge', '--format', '{{range .IPAM.Config}}{{.Gateway}}{{end}}'], {
      stdio: 'pipe',
    });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('close', () => resolve(out.trim() || undefined));
    child.on('error', () => resolve(undefined));
  });
}

// ─── Relay lifecycle ──────────────────────────────────────────────────────────

/**
 * Called from the agent process. Spawns the relay as a detached child if not already running.
 * Returns the baseUrl using the stored proxy config (tunnel, docker host, or loopback).
 */
export async function ensureN8nRelayServer(): Promise<N8nRelayInfo> {
  const existing = getN8nRelayState();
  if (existing && isRelayAlive(existing)) {
    if (await isRelayHealthEndpointCompatible(existing.port)) {
      return buildRelayInfo(existing.port);
    }
    await stopStaleRelay(existing);
  }

  spawnRelayProcess();
  const state = await waitForRelayState(8_000);
  return buildRelayInfo(state.port);
}

export function buildRelayInfo(port: number, platform: NodeJS.Platform = process.platform): N8nRelayInfo {
  const configService = new YagrConfigService();
  const proxyConfig = configService.getLocalConfig().llmProxy;
  const hostBaseUrl = `http://127.0.0.1:${port}/v1`;
  const llmTunnelUrl = proxyConfig?.llmTunnelUrl;

  if (proxyConfig?.mode === 'tunnel' && llmTunnelUrl) {
    return { port, baseUrl: `${llmTunnelUrl}/v1`, hostBaseUrl, apiKey: N8N_RELAY_FAKE_API_KEY };
  }

  if (proxyConfig?.mode === 'docker' && proxyConfig.dockerHostAddress) {
    const dockerHostAddress = normalizeDockerRelayHost(proxyConfig.dockerHostAddress, platform);
    return { port, baseUrl: `http://${dockerHostAddress}:${port}/v1`, hostBaseUrl, apiKey: N8N_RELAY_FAKE_API_KEY };
  }

  return { port, baseUrl: hostBaseUrl, hostBaseUrl, apiKey: N8N_RELAY_FAKE_API_KEY };
}

function spawnRelayProcess(): void {
  ensureYagrHomeDir();
  const paths = getYagrPaths();
  const logDir = path.join(paths.proxyRuntimeDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'llm-relay.log');
  const logFd = fs.openSync(logPath, 'a');

  const entrypoint = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'llm-relay-entrypoint.js',
  );

  const child = spawnDetached(process.execPath, [entrypoint], {
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  fs.closeSync(logFd);
}

async function waitForRelayState(timeoutMs: number): Promise<N8nRelayServerState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = getN8nRelayState();
    if (state && isRelayAlive(state)) {
      return state;
    }
    await delay(200);
  }
  throw new Error(`LLM relay server did not start within ${timeoutMs}ms. Check ~/.yagr/proxy-runtime/logs/llm-relay.log`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearN8nRelayState(): void {
  try {
    const statePath = getYagrPaths().n8nRelayStatePath;
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  } catch {
    // best effort
  }
}

async function stopStaleRelay(state: N8nRelayServerState): Promise<void> {
  if (state.pid === process.pid) {
    closeN8nRelayServerInProcessForTests();
    return;
  }
  await killProcessTree(state.pid).catch(() => false);
  clearN8nRelayState();
}

async function isRelayHealthEndpointCompatible(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    const body = await response.json().catch(() => undefined) as { ok?: unknown; providerReady?: unknown } | undefined;
    return Boolean(
      body
      && typeof body === 'object'
      && (typeof body.ok === 'boolean' || typeof body.providerReady === 'boolean'),
    );
  } catch {
    return false;
  }
}

/**
 * Called inside the detached child process (llm-relay-entrypoint.ts).
 */
export async function ensureN8nRelayServerInProcess(): Promise<N8nRelayInfo> {
  const existing = getN8nRelayState();
  if (existing && isRelayAlive(existing)) {
    if (await isRelayHealthEndpointCompatible(existing.port)) {
      return buildRelayInfo(existing.port);
    }
    await stopStaleRelay(existing);
  }

  const port = await startRelayInProcess();
  return buildRelayInfo(port);
}

/**
 * Stops the in-process relay and clears relay state when this process owns it.
 * For tests only — production uses a detached relay child.
 */
export function closeN8nRelayServerInProcessForTests(): void {
  if (activeServer) {
    try {
      activeServer.closeAllConnections?.();
      activeServer.close();
    } catch {
      // best effort
    }
    activeServer = undefined;
  }
  try {
    const state = getN8nRelayState();
    if (state?.pid === process.pid) {
      clearN8nRelayState();
    }
  } catch {
    // best effort
  }
}

async function attemptListen(server: http.Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('listening', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : port);
    });
    server.once('error', reject);
    server.listen(port, '0.0.0.0');
  });
}

async function canBindLoopbackPort(port: number): Promise<boolean> {
  if (port === 0) {
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen({ host: '127.0.0.1', port, exclusive: true });
  });
}

async function startRelayInProcess(): Promise<number> {
  for (const preferredPort of [N8N_RELAY_DEFAULT_PORT, 0]) {
    if (!(await canBindLoopbackPort(preferredPort))) {
      continue;
    }

    const server = http.createServer((req, res) => {
      void handleRequest(req, res).catch((error) => {
        logRelay('error', 'Unhandled relay request failure', {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          error: formatErrorMessage(error),
        });
        if (!res.headersSent) {
          sendJson(res, 503, {
            error: {
              message: formatErrorMessage(error),
              type: 'server_error',
            },
          });
          return;
        }
        res.end();
      });
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

// ─── HTTP request handling ────────────────────────────────────────────────────

async function resolveProviderRuntime(): Promise<import('./proxy-runtime.js').PrepareProviderRuntimeResult & { resolvedModel: string }> {
  const configService = new YagrConfigService();
  const config = configService.getLocalConfig();
  const resolved = resolveLanguageModelConfig({ provider: config.provider ?? 'openai' }, configService);
  const runtime = await prepareProviderRuntime(resolved.provider as YagrModelProvider, {
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
  });
  return { ...runtime, resolvedModel: resolved.model };
}

/**
 * Replace the `model` field and strip OpenAI-specific fields not supported by
 * all providers (e.g. stream_options causes Mistral 422).
 */
const OPENAI_SPECIFIC_FIELDS = ['stream_options', 'store', 'metadata', 'service_tier', 'reasoning_effort'];

function injectModel(body: Buffer, model: string): Buffer {
  try {
    const parsed = JSON.parse(body.toString('utf-8')) as Record<string, unknown>;
    parsed.model = model;
    for (const field of OPENAI_SPECIFIC_FIELDS) {
      delete parsed[field];
    }
    return Buffer.from(JSON.stringify(parsed), 'utf-8');
  } catch {
    return body;
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function logRelay(level: 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>): void {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  process.stdout.write(`[${new Date().toISOString()}] [llm-relay] [${level}] ${message}${suffix}\n`);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  if (req.method === 'GET' && url === '/v1/health') {
    await handleHealth(res);
    return;
  }

  if (req.method === 'GET' && url === '/v1/models') {
    await handleModels(res);
    return;
  }

  if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/responses')) {
    await handleChatCompletions(req, res, url === '/v1/responses');
    return;
  }

  sendJson(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
}

async function handleHealth(res: http.ServerResponse): Promise<void> {
  try {
    const result = await resolveProviderRuntime();
    if (!result.ready || !result.runtime) {
      sendJson(res, 503, {
        ok: false,
        providerReady: false,
        provider: result.runtime?.provider ?? null,
        resolvedModel: result.resolvedModel,
        reason: result.reason ?? 'Yagr provider not ready.',
        notes: result.notes,
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      providerReady: true,
      provider: result.runtime.provider,
      resolvedModel: result.resolvedModel,
      upstreamBaseUrl: result.runtime.baseUrl,
      modelsDiscovered: result.runtime.models.length,
      notes: result.notes,
    });
  } catch (error) {
    logRelay('error', 'Health probe failed', { error: formatErrorMessage(error) });
    sendJson(res, 503, {
      ok: false,
      providerReady: false,
      reason: formatErrorMessage(error),
    });
  }
}

async function handleModels(res: http.ServerResponse): Promise<void> {
  try {
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
    const models = result.runtime?.models ?? [];
    sendJson(res, 200, {
      object: 'list',
      data: models.map((id) => ({ id, object: 'model', created: 0, owned_by: 'yagr' })),
    });
  } catch (err) {
    logRelay('error', 'Models request failed', { error: formatErrorMessage(err) });
    sendJson(res, 503, { error: { message: String(err), type: 'server_error' } });
  }
}

function extractResponsesTextContent(content: unknown, type: 'input_text' | 'output_text'): string {
  // Plain string content (e.g. n8n sends content as a string, not an array)
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((part): part is { type?: unknown; text?: unknown } => typeof part === 'object' && part !== null)
    .filter((part) => part.type === type && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export function translateResponsesRequestToChatCompletionsBody(body: Buffer): Buffer {
  let payload: ResponsesApiRequest;
  try {
    payload = JSON.parse(body.toString('utf-8')) as ResponsesApiRequest;
  } catch {
    return body;
  }

  if (!payload || typeof payload !== 'object') {
    return body;
  }

  const messages: Array<Record<string, unknown>> = [];

  // Handle string input: treat as a single user message
  if (typeof payload.input === 'string' && (payload.input as string).trim().length > 0) {
    if (typeof payload.instructions === 'string' && payload.instructions.trim().length > 0) {
      messages.push({ role: 'system', content: payload.instructions });
    }
    messages.push({ role: 'user', content: (payload.input as string).trim() });
    const translated: Record<string, unknown> = {
      model: payload.model,
      messages,
      stream: payload.stream ?? false,
    };
    if (typeof payload.max_output_tokens === 'number') {
      translated.max_tokens = payload.max_output_tokens;
    }
    return Buffer.from(JSON.stringify(translated), 'utf-8');
  }

  const input = Array.isArray(payload.input) ? payload.input : [];

  if (typeof payload.instructions === 'string' && payload.instructions.trim().length > 0) {
    messages.push({ role: 'system', content: payload.instructions });
  }

  for (const item of input) {
    const itemType = typeof item.type === 'string' ? item.type : undefined;
    const role = typeof item.role === 'string' ? item.role : undefined;

    if (role === 'user') {
      const text = extractResponsesTextContent(item.content, 'input_text');
      if (text) {
        messages.push({ role: 'user', content: text });
      }
      continue;
    }

    if (role === 'assistant') {
      const text = extractResponsesTextContent(item.content, 'output_text');
      if (text) {
        messages.push({ role: 'assistant', content: text });
      }
      continue;
    }

    if (itemType === 'function_call') {
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: typeof item.call_id === 'string' ? item.call_id : 'call_0',
          type: 'function',
          function: {
            name: typeof item.name === 'string' ? item.name : 'tool',
            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
          },
        }],
      });
      continue;
    }

    if (itemType === 'function_call_output') {
      messages.push({
        role: 'tool',
        tool_call_id: typeof item.call_id === 'string' ? item.call_id : 'call_0',
        content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
      });
    }
  }

  const translated: Record<string, unknown> = {
    model: payload.model,
    messages,
    stream: payload.stream ?? false,
  };

  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    translated.tools = payload.tools.map((tool) => {
      if (tool?.type !== 'function') {
        return tool;
      }
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          ...(tool.strict === true ? { strict: true } : {}),
        },
      };
    });
  }

  if (payload.tool_choice !== undefined) {
    translated.tool_choice = payload.tool_choice;
  }

  if (typeof payload.max_output_tokens === 'number') {
    translated.max_tokens = payload.max_output_tokens;
  }

  return Buffer.from(JSON.stringify(translated), 'utf-8');
}

async function handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse, fromResponsesApi = false): Promise<void> {
  const result = await resolveProviderRuntime();

  if (!result.ready || !result.runtime) {
    logRelay('warn', 'Provider runtime not ready for relay request', {
      method: req.method ?? 'POST',
      url: req.url ?? '/v1/chat/completions',
      reason: result.reason ?? 'provider not ready',
    });
    sendJson(res, 503, {
      error: {
        message: result.reason ?? 'Yagr provider not ready. Make sure Yagr is configured and authenticated.',
        type: 'server_error',
      },
    });
    return;
  }

  const { baseUrl, apiKey, provider, extraHeaders } = result.runtime;
  const { resolvedModel } = result;

  // Anthropic (both direct API key and account session) — use the dedicated translation layer.
  if (provider === 'anthropic' || provider === 'anthropic-proxy') {
    const body = await readBody(req);
    const normalizedBody = fromResponsesApi ? translateResponsesRequestToChatCompletionsBody(body) : body;
    await handleAnthropicRelay(req, res, injectModel(normalizedBody, resolvedModel), apiKey ?? '', { fromResponsesApi });
    return;
  }

  // OpenAI account (openai-oauth) uses chatgpt.com/backend-api/codex/responses,
  // not the standard /chat/completions endpoint — use the dedicated translation layer.
  if (provider === 'openai-oauth') {
    const body = await readBody(req);
    const normalizedBody = fromResponsesApi ? translateResponsesRequestToChatCompletionsBody(body) : body;
    await handleOpenAiAccountRelay(req, res, injectModel(normalizedBody, resolvedModel), { fromResponsesApi });
    return;
  }

  if (!baseUrl) {
    logRelay('warn', 'Provider does not expose an OpenAI-compatible base URL', {
      provider,
      method: req.method ?? 'POST',
      url: req.url ?? '/v1/chat/completions',
    });
    sendJson(res, 503, {
      error: {
        message: 'Active provider does not expose an OpenAI-compatible base URL. Use a dedicated n8n credential for this provider instead.',
        type: 'server_error',
      },
    });
    return;
  }

  const body = await readBody(req);
  const bodyWithModel = injectModel(body, resolvedModel);

  const forwardHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    forwardHeaders['Authorization'] = `Bearer ${apiKey}`;
  }
  if (extraHeaders) {
    Object.assign(forwardHeaders, extraHeaders);
  }
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (lower.startsWith('openai-') || lower.startsWith('anthropic-') || lower.startsWith('x-')) {
      forwardHeaders[key] = String(value);
    }
  }

  // Providers that don't support /responses natively need a round-trip translation:
  // Responses request → chat/completions → translate response back to Responses format.
  if (fromResponsesApi && !PROVIDERS_WITH_NATIVE_RESPONSES_API.has(provider)) {
    const chatBody = translateResponsesRequestToChatCompletionsBody(bodyWithModel);
    const chatUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let upstreamChat: Response;
    try {
      upstreamChat = await fetch(chatUrl, {
        method: 'POST',
        headers: forwardHeaders,
        body: chatBody.buffer.slice(chatBody.byteOffset, chatBody.byteOffset + chatBody.byteLength) as ArrayBuffer,
      });
    } catch (error) {
      logRelay('error', 'Upstream chat/completions request failed', {
        provider,
        targetUrl: chatUrl,
        error: formatErrorMessage(error),
      });
      sendJson(res, 503, {
        error: {
          message: `Upstream request failed: ${formatErrorMessage(error)}`,
          type: 'server_error',
        },
      });
      return;
    }

    if (!upstreamChat.ok || !upstreamChat.body) {
      const errText = await upstreamChat.text().catch(() => '');
      logRelay('warn', 'Upstream chat/completions returned an error', {
        provider,
        targetUrl: chatUrl,
        status: upstreamChat.status,
        body: errText.slice(0, 300),
      });
      res.writeHead(upstreamChat.status, { 'Content-Type': 'application/json' });
      res.end(errText || JSON.stringify({ error: { message: `Upstream error: HTTP ${upstreamChat.status}`, type: 'server_error' } }));
      return;
    }

    const contentType = upstreamChat.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      await pipeChatCompletionsSseAsResponsesApi(upstreamChat, res, resolvedModel);
    } else {
      const chatCompletion = (await upstreamChat.json()) as Record<string, unknown>;
      const responsesApiBody = translateChatCompletionToResponsesApi(chatCompletion, resolvedModel);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responsesApiBody));
    }
    return;
  }

  // Native transparent proxy: forward to /responses or /chat/completions as-is.
  const targetUrl = fromResponsesApi
    ? `${baseUrl.replace(/\/+$/, '')}/responses`
    : `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: forwardHeaders,
      body: bodyWithModel.buffer.slice(bodyWithModel.byteOffset, bodyWithModel.byteOffset + bodyWithModel.byteLength) as ArrayBuffer,
    });
  } catch (error) {
    logRelay('error', 'Upstream relay request failed', {
      provider,
      targetUrl,
      error: formatErrorMessage(error),
    });
    sendJson(res, 503, {
      error: {
        message: `Upstream request failed: ${formatErrorMessage(error)}`,
        type: 'server_error',
      },
    });
    return;
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    logRelay('warn', 'Upstream relay request returned an error', {
      provider,
      targetUrl,
      status: upstream.status,
      body: errText.slice(0, 300),
    });
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    });
    res.end(errText || JSON.stringify({ error: { message: `Upstream error: HTTP ${upstream.status}`, type: 'server_error' } }));
    return;
  }

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
