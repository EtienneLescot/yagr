import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDisplayProjectName,
  type IProject,
} from 'n8nac';
import { YagrSessionAgent } from '../agent.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import type { EngineRuntimePort } from '../engine/engine.js';
import { resolveTelegramBotIdentity } from './telegram.js';
import { YagrSetupApplicationService } from '../setup/application-services.js';
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
import {
  providerRequiresApiKey,
  YAGR_SELECTABLE_MODEL_PROVIDERS,
} from '../llm/provider-registry.js';
import { resolveManagedN8nWorkflowOpen } from '../n8n-local/workflow-open.js';
import {
  mapPhaseEventToUserVisibleUpdate,
  mapStateEventToUserVisibleUpdate,
  mapToolEventToUserVisibleUpdate,
} from '../runtime/user-visible-updates.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3789;
const VALID_PROVIDERS: YagrModelProvider[] = [...YAGR_SELECTABLE_MODEL_PROVIDERS];
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
  | { type: 'embed'; kind: 'workflow'; workflowId: string; url: string; targetUrl?: string; title?: string; diagram?: string };

export function mapToolEventToWebUiStreamEvent(event: YagrToolEvent): WebUiChatStreamEvent | undefined {
  const userFacingStatus = mapToolEventToUserVisibleUpdate(event);
  if (userFacingStatus) {
    return {
      type: 'progress',
      tone: userFacingStatus.tone,
      title: userFacingStatus.title,
      detail: userFacingStatus.detail,
      ...(userFacingStatus.phase ? { phase: userFacingStatus.phase } : {}),
    };
  }

  if (event.type === 'embed') {
    return {
      type: 'embed',
      kind: event.kind,
      workflowId: event.workflowId,
      url: event.url,
      targetUrl: event.targetUrl,
      title: event.title,
      diagram: event.diagram,
    };
  }

  return undefined;
}

export function mapPhaseEventToWebUiStreamEvent(event: YagrPhaseEvent): WebUiChatStreamEvent | undefined {
  const update = mapPhaseEventToUserVisibleUpdate(event);
  if (!update) {
    return undefined;
  }

  return {
    type: 'progress',
    tone: update.tone,
    title: update.title,
    detail: update.detail,
    ...(update.phase ? { phase: update.phase } : {}),
  };
}

export function mapStateEventToWebUiStreamEvent(event: YagrStateEvent): WebUiChatStreamEvent | undefined {
  const update = mapStateEventToUserVisibleUpdate(event);
  if (!update) {
    return undefined;
  }

  return {
    type: 'progress',
    tone: update.tone,
    title: update.title,
    detail: update.detail,
    ...(update.phase ? { phase: update.phase } : {}),
  };
}

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

export function getWebUiGatewayStatus(configService = new YagrConfigService()): WebUiGatewayStatus {
  const config = getWebUiConfig(configService);
  return {
    configured: true,
    host: config.host,
    port: config.port,
    url: `http://${config.host}:${config.port}`,
  };
}

export function createWebUiGatewayRuntime(
  engineResolver: () => Promise<EngineRuntimePort>,
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
  private enginePromise?: Promise<EngineRuntimePort>;
  private readonly agents = new Map<string, YagrSessionAgent>();
  private readonly setupService: YagrSetupApplicationService;

  constructor(
    private readonly engineResolver: () => Promise<EngineRuntimePort>,
    private readonly options: YagrRunOptions,
    private readonly configService: YagrConfigService,
    private readonly status: WebUiGatewayStatus,
  ) {
    this.setupService = new YagrSetupApplicationService(this.configService, new YagrN8nConfigService(), {
      resolveTelegramIdentity: resolveTelegramBotIdentity,
    });
  }

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
      const projects = await this.setupService.fetchN8nProjects(String(body.host ?? ''), body.apiKey ? String(body.apiKey) : undefined);
      this.sendJson(response, 200, {
        projects: projects.map((project) => ({ id: project.id, name: getDisplayProjectName(project) })),
        selectedProjectId: this.setupService.getSelectedN8nProjectId(),
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
      this.sendJson(response, 200, {
        models: await this.setupService.fetchModelsForSelection({
          provider,
          apiKey: body.apiKey !== undefined ? String(body.apiKey) : undefined,
          baseUrl: body.baseUrl ? String(body.baseUrl) : undefined,
          requiresApiKey: providerRequiresApiKey,
        }),
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

      this.setupService.saveLlmConfig({
        provider,
        apiKey,
        model,
        baseUrl: body.baseUrl ? String(body.baseUrl) : undefined,
      });

      this.sendJson(response, 200, { snapshot: await this.buildSnapshot() });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/config/surfaces') {
      const body = await this.readJson(request);
      const enabledSurfaces = Array.isArray(body.enabledSurfaces)
        ? body.enabledSurfaces.filter((surface) => surface === 'telegram' || surface === 'whatsapp')
        : [];
      this.setupService.saveSurfaces({ surfaces: enabledSurfaces });
      this.sendJson(response, 200, { snapshot: await this.buildSnapshot() });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/telegram/configure') {
      const body = await this.readJson(request);
      await this.setupService.configureTelegram(String(body.botToken ?? ''));
      this.sendJson(response, 200, { snapshot: await this.buildSnapshot() });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/telegram/reset') {
      this.setupService.resetTelegram();
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

      const setupStatus = this.setupService.getSetupStatus({
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

    if (method === 'GET' && url.pathname === '/api/n8n/workflow-session') {
      const target = String(url.searchParams.get('target') ?? '').trim();
      await this.sendManagedN8nWorkflowSession(response, target);
      return;
    }

    if (method === 'GET' && url.pathname === '/open/n8n-workflow') {
      const target = String(url.searchParams.get('target') ?? '').trim();
      await this.openManagedN8nWorkflow(response, target);
      return;
    }

    this.sendJson(response, 404, { error: 'Not found' });
  }

  private async buildSnapshot(): Promise<Record<string, unknown>> {
    const webUiStatus = getWebUiGatewayStatus(this.configService);
    return this.setupService.buildWebUiSnapshot({
      activeSurfaces: [...ACTIVE_WEBUI_SURFACES],
      webUiStatus,
      selectableProviders: VALID_PROVIDERS,
    });
  }

  private async sendManagedN8nWorkflowSession(response: ServerResponse, target: string): Promise<void> {
    const session = resolveManagedN8nWorkflowOpen(target);
    if (!session.ok) {
      this.sendJson(response, session.statusCode, { error: session.error });
      return;
    }

    this.sendJson(response, 200, session.payload);
  }

  private async openManagedN8nWorkflow(response: ServerResponse, target: string): Promise<void> {
    const session = resolveManagedN8nWorkflowOpen(target);
    if (!session.ok) {
      this.sendText(response, session.statusCode, session.error, 'text/plain; charset=utf-8');
      return;
    }

    if (session.payload.mode === 'direct') {
      response.writeHead(302, { Location: session.payload.targetUrl });
      response.end();
      return;
    }

    this.sendText(response, 200, session.payload.fallbackPage, 'text/html; charset=utf-8');
  }

  private async saveN8nConfig(input: { host: string; apiKey?: string; projectId: string; syncFolder: string }): Promise<string | undefined> {
    const warning = await this.setupService.saveN8nConfig(input);
    // Invalidate the cached engine and all agent sessions so the next request
    // picks up a fresh engine built from the new config (new host, new API key).
    this.enginePromise = undefined;
    this.agents.clear();
    return warning;
  }

  private assertProvider(value: string): YagrModelProvider {
    if (!VALID_PROVIDERS.includes(value as YagrModelProvider)) {
      throw new Error(`Unknown provider: ${value}`);
    }
    return value as YagrModelProvider;
  }

  private async resolveAgent(sessionId: string): Promise<YagrSessionAgent> {
    const existing = this.agents.get(sessionId);
    if (existing) {
      return existing;
    }

    if (!this.enginePromise) {
      this.enginePromise = this.engineResolver();
    }

    const engine = await this.enginePromise;
    const agent = new YagrSessionAgent(engine);
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
    const setupStatus = this.setupService.getSetupStatus({
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
      const mappedEvent = mapPhaseEventToWebUiStreamEvent(event);
      if (mappedEvent) {
        writeEvent(mappedEvent);
        return;
      }

      if (event.status === 'started') {
        writeEvent({
          type: 'phase',
          phase: event.phase,
          status: event.status,
          message: event.message,
        });
      }
    };

    const pushStateEvent = (event: YagrStateEvent) => {
      const mappedEvent = mapStateEventToWebUiStreamEvent(event);
      if (mappedEvent) {
        writeEvent(mappedEvent);
        return;
      }

      if (event.state !== 'running' && event.state !== 'streaming' && event.state !== 'completed') {
        writeEvent({
          type: 'state',
          state: event.state,
          message: event.message,
        });
      }
    };

    const pushToolEvent = (event: YagrToolEvent) => {
      const mappedEvent = mapToolEventToWebUiStreamEvent(event);
      if (mappedEvent) {
        writeEvent(mappedEvent);
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
