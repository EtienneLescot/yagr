import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  N8nApiClient,
  WorkspaceSetupService,
  getDisplayProjectName,
  type IProject,
} from 'n8nac';
import { Command } from 'commander';
import { UpdateAiCommand } from 'n8nac/dist/commands/init-ai.js';
import { YagrAgent } from '../agent.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { getYagrN8nWorkspaceDir } from '../config/yagr-home.js';
import type { Engine } from '../engine/engine.js';
import {
  createOnboardingToken,
  getTelegramGatewayStatus,
  resetTelegramGateway,
} from './telegram.js';
import { getYagrSetupStatus } from '../setup.js';
import type { Gateway, GatewayRuntimeHandle } from './types.js';
import type {
  YagrContextCompactionEvent,
  YagrModelProvider,
  YagrPhaseEvent,
  YagrRunOptions,
  YagrStateEvent,
  YagrToolEvent,
} from '../types.js';
import { resolveLanguageModelConfig } from '../llm/create-language-model.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3789;
const VALID_PROVIDERS: YagrModelProvider[] = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'mistral',
  'openrouter',
];
const ACTIVE_WEBUI_SURFACES = ['webui'] as const;

const WEB_UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Yagr Web UI</title>
    <link rel="stylesheet" href="/styles.css" />
    <script defer src="/app.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
  </html>`;

export interface WebUiGatewayStatus {
  configured: boolean;
  host: string;
  port: number;
  url: string;
}

interface WebUiConfigPayload {
  host?: string;
  port?: number;
}

type WebUiChatStreamEvent =
  | { type: 'start'; sessionId: string; message: string }
  | { type: 'phase'; phase: string; status: 'started' | 'completed'; message: string }
  | { type: 'state'; state: string; message: string }
  | { type: 'progress'; tone: 'info' | 'success' | 'error'; title: string; detail?: string; phase?: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'final'; sessionId: string; response: string; finalState: string; requiredActions?: Array<{ title: string; message: string }> }
  | { type: 'error'; error: string }
  | { type: 'embed'; kind: 'workflow'; workflowId: string; url: string; title?: string; diagram?: string };

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function sanitizeHost(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_HOST;
}

function sanitizePort(value: number | undefined): number {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 65535) {
    return DEFAULT_PORT;
  }
  return Number(value);
}

function getWebUiConfig(configService = new YagrConfigService()): Required<WebUiConfigPayload> {
  const config = configService.getLocalConfig();
  return {
    host: sanitizeHost(config.gateway?.webui?.host),
    port: sanitizePort(config.gateway?.webui?.port),
  };
}

function persistWebUiConfig(configService = new YagrConfigService(), nextConfig: WebUiConfigPayload): Required<WebUiConfigPayload> {
  const normalized = {
    host: sanitizeHost(nextConfig.host),
    port: sanitizePort(nextConfig.port),
  };

  configService.updateLocalConfig((localConfig) => ({
    ...localConfig,
    gateway: {
      ...localConfig.gateway,
      webui: normalized,
    },
  }));

  return normalized;
}

export function getWebUiGatewayStatus(configService = new YagrConfigService()): WebUiGatewayStatus {
  const config = persistWebUiConfig(configService, getWebUiConfig(configService));
  return {
    configured: true,
    host: config.host,
    port: config.port,
    url: `http://${config.host}:${config.port}`,
  };
}

export function createWebUiGatewayRuntime(
  engineResolver: () => Promise<Engine>,
  options: YagrRunOptions = {},
  configService = new YagrConfigService(),
): GatewayRuntimeHandle {
  const status = getWebUiGatewayStatus(configService);
  return {
    gateway: new WebUiGateway(engineResolver, options, configService, status),
    startupMessages: [
      `Yagr Web UI listening at ${status.url}.`,
      'Open the local UI to configure the runtime, link Telegram, and chat with Yagr.',
    ],
    onboardingLink: status.url,
  };
}

class WebUiGateway implements Gateway {
  private server?: Server;
  private enginePromise?: Promise<Engine>;
  private readonly agents = new Map<string, YagrAgent>();

  constructor(
    private readonly engineResolver: () => Promise<Engine>,
    private readonly options: YagrRunOptions,
    private readonly configService: YagrConfigService,
    private readonly status: WebUiGatewayStatus,
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = createServer(async (request, response) => {
      try {
        await this.handleRequest(request, response);
      } catch (error) {
        this.sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.status.port, this.status.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async reply(): Promise<void> {}

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', this.status.url);

    if (method === 'GET' && url.pathname === '/') {
      this.sendText(response, 200, WEB_UI_HTML, 'text/html; charset=utf-8');
      return;
    }

    if (method === 'GET' && (url.pathname === '/styles.css' || url.pathname === '/app.css')) {
      await this.sendStaticAsset(response, 'styles.css', 'text/css; charset=utf-8');
      return;
    }

    if (method === 'GET' && url.pathname === '/app.js') {
      await this.sendStaticAsset(response, 'app.js', 'application/javascript; charset=utf-8');
      return;
    }

    if (method === 'GET' && url.pathname === '/api/config') {
      this.sendJson(response, 200, await this.buildSnapshot());
      return;
    }

    if (method === 'POST' && url.pathname === '/api/n8n/projects') {
      const body = await this.readJson(request);
      const projects = await this.fetchN8nProjects(String(body.host ?? ''), body.apiKey ? String(body.apiKey) : undefined);
      const current = new YagrN8nConfigService().getLocalConfig();
      this.sendJson(response, 200, {
        projects: projects.map((project) => ({ id: project.id, name: getDisplayProjectName(project) })),
        selectedProjectId: current.projectId,
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/config/n8n') {
      const body = await this.readJson(request);
      const warning = await this.saveN8nConfig({
        host: String(body.host ?? ''),
        apiKey: body.apiKey ? String(body.apiKey) : undefined,
        projectId: String(body.projectId ?? ''),
        syncFolder: String(body.syncFolder ?? 'workflows'),
      });
      this.sendJson(response, 200, {
        warning,
        snapshot: await this.buildSnapshot(),
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/llm/models') {
      const body = await this.readJson(request);
      const provider = this.assertProvider(String(body.provider ?? ''));
      const apiKey = body.apiKey ? String(body.apiKey) : this.configService.getApiKey(provider);
      if (!apiKey) {
        throw new Error(`No API key available for ${provider}. Save one first.`);
      }

      this.sendJson(response, 200, {
        models: await fetchAvailableModels(provider, apiKey),
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/config/llm') {
      const body = await this.readJson(request);
      const provider = this.assertProvider(String(body.provider ?? ''));
      const apiKey = body.apiKey ? String(body.apiKey) : undefined;
      const model = String(body.model ?? '').trim();
      if (!model) {
        throw new Error('Model is required.');
      }

      if (apiKey) {
        this.configService.saveApiKey(provider, apiKey);
      }

      this.configService.updateLocalConfig((localConfig) => ({
        ...localConfig,
        provider,
        model,
        baseUrl: body.baseUrl ? String(body.baseUrl) : undefined,
      }));

      this.sendJson(response, 200, { snapshot: await this.buildSnapshot() });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/config/surfaces') {
      const body = await this.readJson(request);
      const enabledSurfaces = Array.isArray(body.enabledSurfaces)
        ? body.enabledSurfaces.filter((surface) => surface === 'telegram' || surface === 'whatsapp')
        : [];
      this.configService.setEnabledGatewaySurfaces(enabledSurfaces);
      this.sendJson(response, 200, { snapshot: await this.buildSnapshot() });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/telegram/configure') {
      const body = await this.readJson(request);
      const botToken = String(body.botToken ?? '').trim();
      if (!botToken || !botToken.includes(':')) {
        throw new Error('Enter a valid Telegram BotFather token.');
      }

      const identity = await resolveTelegramBotIdentity(botToken);
      this.configService.saveTelegramBotToken(botToken);
      this.configService.enableGatewaySurface('telegram');
      this.configService.updateLocalConfig((localConfig) => ({
        ...localConfig,
        telegram: {
          ...localConfig.telegram,
          botUsername: identity.username,
          onboardingToken: localConfig.telegram?.onboardingToken ?? createOnboardingToken(),
          linkedChats: localConfig.telegram?.linkedChats ?? [],
        },
      }));

      this.sendJson(response, 200, { snapshot: await this.buildSnapshot() });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/telegram/reset') {
      resetTelegramGateway(this.configService);
      this.sendJson(response, 200, { snapshot: await this.buildSnapshot() });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/chat') {
      const body = await this.readJson(request);
      const message = String(body.message ?? '').trim();
      const sessionId = String(body.sessionId ?? randomUUID());
      if (!message) {
        throw new Error('Message is required.');
      }

      const setupStatus = getYagrSetupStatus(this.configService, new YagrN8nConfigService(), {
        activeSurfaces: [...ACTIVE_WEBUI_SURFACES],
      });
      if (!setupStatus.ready) {
        throw new Error(`Yagr is not ready yet. Missing: ${setupStatus.missingSteps.join(', ')}.`);
      }

      const agent = await this.resolveAgent(sessionId);
      const resolvedConfig = resolveLanguageModelConfig({}, this.configService);
      const result = await agent.run(message, {
        ...this.options,
        provider: resolvedConfig.provider,
        model: resolvedConfig.model,
        apiKey: resolvedConfig.apiKey,
        baseUrl: resolvedConfig.baseUrl,
      });
      this.sendJson(response, 200, {
        sessionId,
        response: result.text,
        requiredActions: result.requiredActions,
        finalState: result.finalState,
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/chat/stream') {
      const body = await this.readJson(request);
      const message = String(body.message ?? '').trim();
      const sessionId = String(body.sessionId ?? randomUUID());
      if (!message) {
        throw new Error('Message is required.');
      }

      await this.handleStreamingChat(response, sessionId, message);
      return;
    }

    if (method === 'POST' && url.pathname === '/api/chat/reset') {
      const body = await this.readJson(request);
      const sessionId = String(body.sessionId ?? '');
      if (sessionId) {
        this.agents.delete(sessionId);
      }
      this.sendJson(response, 200, { ok: true });
      return;
    }

    this.sendJson(response, 404, { error: 'Not found' });
  }

  private async buildSnapshot(): Promise<Record<string, unknown>> {
    const n8nService = new YagrN8nConfigService();
    const n8nConfig = n8nService.getLocalConfig();
    const setupStatus = getYagrSetupStatus(this.configService, n8nService, {
      activeSurfaces: [...ACTIVE_WEBUI_SURFACES],
    });
    const telegramStatus = getTelegramGatewayStatus(this.configService);
    const webUiStatus = getWebUiGatewayStatus(this.configService);
    const yagrConfig = this.configService.getLocalConfig();
    const enabledSurfaces = Array.from(new Set([...this.configService.getEnabledGatewaySurfaces(), ...ACTIVE_WEBUI_SURFACES]));
    const startableSurfaces = enabledSurfaces.filter((surface) => surface === 'webui' || (surface === 'telegram' && telegramStatus.configured));

    let availableModels: string[] = [];
    if (yagrConfig.provider) {
      const apiKey = this.configService.getApiKey(yagrConfig.provider);
      if (apiKey) {
        try {
          availableModels = await fetchAvailableModels(yagrConfig.provider, apiKey);
        } catch {
          availableModels = [];
        }
      }
    }

    return {
      setupStatus,
      gatewayStatus: {
        enabledSurfaces,
        startableSurfaces,
      },
      telegram: telegramStatus,
      webui: webUiStatus,
      yagr: {
        provider: yagrConfig.provider,
        model: yagrConfig.model,
        baseUrl: yagrConfig.baseUrl,
        providers: VALID_PROVIDERS.map((provider) => ({
          provider,
          apiKeyStored: this.configService.hasApiKey(provider),
        })),
      },
      n8n: {
        host: n8nConfig.host,
        syncFolder: n8nConfig.syncFolder,
        projectId: n8nConfig.projectId,
        projectName: n8nConfig.projectName,
        apiKeyStored: Boolean(n8nConfig.host && n8nService.getApiKey(n8nConfig.host)),
        projects: n8nConfig.projectId && n8nConfig.projectName ? [{ id: n8nConfig.projectId, name: n8nConfig.projectName }] : [],
      },
      availableModels,
    };
  }

  private async fetchN8nProjects(host: string, apiKeyOverride?: string): Promise<IProject[]> {
    const normalizedHost = host.trim();
    if (!normalizedHost) {
      throw new Error('n8n host is required.');
    }

    const configService = new YagrN8nConfigService();
    const apiKey = apiKeyOverride ?? configService.getApiKey(normalizedHost);
    if (!apiKey) {
      throw new Error('No n8n API key available for that host.');
    }

    const client = new N8nApiClient({ host: normalizedHost, apiKey });
    const connected = await client.testConnection();
    if (!connected) {
      throw new Error('Unable to connect to n8n with the provided URL and API key.');
    }

    return client.getProjects();
  }

  private async saveN8nConfig(input: { host: string; apiKey?: string; projectId: string; syncFolder: string }): Promise<string | undefined> {
    const host = input.host.trim();
    const projectId = input.projectId.trim();
    const syncFolder = input.syncFolder.trim() || 'workflows';
    if (!host) {
      throw new Error('n8n host is required.');
    }
    if (!projectId) {
      throw new Error('Select an n8n project first.');
    }

    const configService = new YagrN8nConfigService();
    const apiKey = input.apiKey?.trim() || configService.getApiKey(host);
    if (!apiKey) {
      throw new Error('An n8n API key is required.');
    }

    const projects = await this.fetchN8nProjects(host, apiKey);
    const selectedProject = projects.find((project) => project.id === projectId);
    if (!selectedProject) {
      throw new Error('The selected n8n project could not be found. Reload projects and try again.');
    }

    configService.saveApiKey(host, apiKey);
    configService.saveBootstrapState(host, syncFolder);
    const instanceIdentifier = await configService.getOrCreateInstanceIdentifier(host);
    configService.saveLocalConfig({
      host,
      syncFolder,
      projectId: selectedProject.id,
      projectName: getDisplayProjectName(selectedProject),
      instanceIdentifier,
    });
    WorkspaceSetupService.ensureWorkspaceFiles(syncFolder);

    try {
      await refreshAiContext({ host, apiKey });
      return undefined;
    } catch (error) {
      return `Workspace saved, but the n8n workspace instructions refresh failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private assertProvider(value: string): YagrModelProvider {
    if (!VALID_PROVIDERS.includes(value as YagrModelProvider)) {
      throw new Error(`Unknown provider: ${value}`);
    }
    return value as YagrModelProvider;
  }

  private async resolveAgent(sessionId: string): Promise<YagrAgent> {
    const existing = this.agents.get(sessionId);
    if (existing) {
      return existing;
    }

    if (!this.enginePromise) {
      this.enginePromise = this.engineResolver();
    }

    const engine = await this.enginePromise;
    const agent = new YagrAgent(engine);
    this.agents.set(sessionId, agent);
    return agent;
  }

  private async readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
      return {};
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
  }

  private sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(payload));
  }

  private sendText(response: ServerResponse, statusCode: number, text: string, contentType: string): void {
    response.writeHead(statusCode, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    response.end(text);
  }

  private async sendStaticAsset(response: ServerResponse, fileName: string, contentType: string): Promise<void> {
    const assetPath = path.resolve(__dirname, '..', 'webui', fileName);
    const content = await readFile(assetPath, 'utf-8');
    this.sendText(response, 200, content, contentType);
  }

  private async handleStreamingChat(response: ServerResponse, sessionId: string, message: string): Promise<void> {
    const setupStatus = getYagrSetupStatus(this.configService, new YagrN8nConfigService(), {
      activeSurfaces: [...ACTIVE_WEBUI_SURFACES],
    });
    if (!setupStatus.ready) {
      this.sendJson(response, 400, { error: `Yagr is not ready yet. Missing: ${setupStatus.missingSteps.join(', ')}.` });
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const abortController = new AbortController();
    let runFinished = false;
    let streamedText = '';

    const handleConnectionClose = () => {
      if (!runFinished && !abortController.signal.aborted) {
        abortController.abort();
      }
    };

    response.on('close', handleConnectionClose);

    const writeEvent = (event: WebUiChatStreamEvent) => {
      if (response.writableEnded || response.destroyed) {
        return;
      }

      response.write(`${JSON.stringify(event)}\n`);
    };

    const pushPhaseEvent = (event: YagrPhaseEvent) => {
      if (event.status !== 'started') {
        return;
      }

      writeEvent({
        type: 'phase',
        phase: event.phase,
        status: event.status,
        message: event.message,
      });
    };

    const pushStateEvent = (event: YagrStateEvent) => {
      if (event.state === 'running' || event.state === 'streaming' || event.state === 'completed') {
        return;
      }

      writeEvent({
        type: 'state',
        state: event.state,
        message: event.message,
      });
    };

    const pushToolEvent = (event: YagrToolEvent) => {
      if (event.type === 'status') {
        writeEvent({
          type: 'progress',
          tone: 'info',
          title: event.toolName === 'reportProgress' ? 'Progress' : `Tool ${event.toolName}`,
          detail: event.message,
        });
        return;
      }

      if (event.type === 'command-end') {
        if (event.exitCode === 0) {
          return;
        }

        writeEvent({
          type: 'progress',
          tone: 'info',
          title: 'Correcting commands',
          detail: event.message,
        });
        return;
      }

      if (event.type === 'embed') {
        writeEvent({
          type: 'embed',
          kind: event.kind,
          workflowId: event.workflowId,
          url: event.url,
          title: event.title,
          diagram: event.diagram,
        });
        return;
      }
    };

    const pushCompactionEvent = (event: YagrContextCompactionEvent) => {
      writeEvent({
        type: 'progress',
        tone: 'info',
        title: 'Context compacted',
        detail: `${event.messagesCompacted} messages folded to keep the run responsive.`,
      });
    };

    try {
      writeEvent({
        type: 'start',
        sessionId,
        message: 'Run started. Inspecting workspace and request.',
      });

      const agent = await this.resolveAgent(sessionId);
      const resolvedConfig = resolveLanguageModelConfig({}, this.configService);
      const result = await agent.run(message, {
        ...this.options,
        provider: resolvedConfig.provider,
        model: resolvedConfig.model,
        apiKey: resolvedConfig.apiKey,
        baseUrl: resolvedConfig.baseUrl,
        onPhaseChange: async (event) => {
          pushPhaseEvent(event);
          await this.options.onPhaseChange?.(event);
        },
        onStateChange: async (event) => {
          pushStateEvent(event);
          await this.options.onStateChange?.(event);
        },
        onToolEvent: async (event) => {
          pushToolEvent(event);
          await this.options.onToolEvent?.(event);
        },
        onCompaction: async (event) => {
          pushCompactionEvent(event);
          await this.options.onCompaction?.(event);
        },
        onTextDelta: async (delta) => {
          streamedText += delta;
          writeEvent({ type: 'text-delta', delta });
          await this.options.onTextDelta?.(delta);
        },
        abortSignal: abortController.signal,
      });
      runFinished = true;

      writeEvent({
        type: 'final',
        sessionId,
        response: result.text,
        finalState: result.finalState,
        requiredActions: result.requiredActions.map((action) => ({
          title: action.title,
          message: action.message,
        })),
      });
    } catch (error) {
      if (isAbortError(error)) {
        runFinished = true;
        writeEvent({
          type: 'final',
          sessionId,
          response: streamedText,
          finalState: 'stopped',
          requiredActions: [],
        });
      } else {
        writeEvent({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      response.off('close', handleConnectionClose);
      response.end();
    }
  }
}

async function fetchAvailableModels(provider: YagrModelProvider, apiKey: string): Promise<string[]> {
  const endpoints: Partial<Record<YagrModelProvider, { url: string; map: (data: any) => string[] }>> = {
    openrouter: {
      url: 'https://openrouter.ai/api/v1/models',
      map: (data) => data.data?.map((model: { id: string }) => model.id) ?? [],
    },
    openai: {
      url: 'https://api.openai.com/v1/models',
      map: (data) => data.data?.map((model: { id: string }) => model.id) ?? [],
    },
    groq: {
      url: 'https://api.groq.com/openai/v1/models',
      map: (data) => data.data?.map((model: { id: string }) => model.id) ?? [],
    },
    mistral: {
      url: 'https://api.mistral.ai/v1/models',
      map: (data) => data.data?.map((model: { id: string }) => model.id) ?? [],
    },
  };

  const endpoint = endpoints[provider];
  if (!endpoint) {
    return [];
  }

  const response = await fetch(endpoint.url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return endpoint.map(payload).sort((left, right) => left.localeCompare(right));
}

async function resolveTelegramBotIdentity(botToken: string): Promise<{ username: string; firstName: string }> {
  const { Telegraf } = await import('telegraf');
  const bot = new Telegraf(botToken);
  const me = await bot.telegram.getMe();
  if (!me.username) {
    throw new Error('Telegram bot username is missing. Configure the bot with BotFather first.');
  }

  return {
    username: me.username,
    firstName: me.first_name,
  };
}

async function refreshAiContext(credentials: { host: string; apiKey: string }): Promise<void> {
  const updateAi = new UpdateAiCommand(new Command());
  const previousCwd = process.cwd();

  try {
    process.chdir(getYagrN8nWorkspaceDir());
    await updateAi.run({}, credentials);
  } finally {
    process.chdir(previousCwd);
  }
}