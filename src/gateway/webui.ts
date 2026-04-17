import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDisplayProjectName,
  type IProject,
} from 'n8nac';
import { getYagrDeepAgentSessionsDir, getYagrMemoriesDir, getYagrSessionsDir } from '../config/yagr-home.js';
import { MemoryStore } from '../memory/memory-store.js';
import { extractSessionMemory } from '../memory/extract-session-memory.js';
import { WebUiSessionRegistry } from '../session/webui-sessions.js';
import type { SerializedChatMessage, SessionSummary } from '../session/session-types.js';
import { buildDeepAgentSessionConfig, DeepAgentSessionStore, deriveSessionTitle } from '../session/deepagent-sessions.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { resolveTelegramBotIdentity } from './telegram.js';
import { YagrSetupApplicationService } from '../setup/application-services.js';
import type { Gateway, GatewayRuntimeHandle } from './types.js';
import type {
  YagrModelProvider,
  YagrRunOptions,
} from '../types.js';
import {
  providerRequiresApiKey,
  YAGR_SELECTABLE_MODEL_PROVIDERS,
} from '../llm/provider-registry.js';
import { resolveManagedN8nWorkflowOpen } from '../n8n-local/workflow-open.js';
import { createYagrDeepAgent, type YagrDeepAgentHandle } from '../agent-factory.js';
import { decodeHtmlDataUrl, resolvePreferredWorkflowOpenBridgeUrl, resolveStoredWorkflowOpenTarget } from './local-open-bridge.js';
import { getWebUiConfig, getWebUiGatewayStatus, type WebUiGatewayStatus } from './webui-config.js';
import {
  createRunAccumulator,
  processStreamEvent,
  extractLastAiMessage,
} from './langgraph-events.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export { getWebUiGatewayStatus, type WebUiGatewayStatus } from './webui-config.js';

type WebUiChatStreamEvent =
  | { type: 'start'; sessionId: string; message: string }
  | { type: 'progress'; tone: 'info' | 'success' | 'error'; title: string; detail?: string; phase?: string }
  | {
      type: 'operation';
      operationId: string;
      label: string;
      category: string;
      status: 'running' | 'done' | 'error';
      body?: string;
      summary?: string;
      startedAt: number;
      endedAt?: number;
    }
  | { type: 'text-delta'; delta: string }
  | { type: 'final'; sessionId: string; response: string; finalState: string; requiredActions?: Array<{ title: string; message: string }> }
  | { type: 'error'; error: string }
  | { type: 'embed'; kind: 'workflow'; workflowId: string; url: string; openUrl?: string; targetUrl?: string; title?: string; diagram?: string; executionResult?: { status: 'success' | 'error' | 'waiting'; executionId?: string; summary?: string; data?: string } };

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject IDs that could escape the sessions/memories directories. */
function isValidSessionId(id: string): boolean {
  return UUID_RE.test(id);
}

export function createWebUiGatewayRuntime(
  options: YagrRunOptions = {},
  configService = new YagrConfigService(),
): GatewayRuntimeHandle {
  const status = getWebUiGatewayStatus(configService);
  return {
    gateway: new WebUiGateway(options, configService, status),
    startupMessages: [
      `Yagr Web UI listening at ${status.url}.`,
      'Open the local UI to configure the runtime, link Telegram, and chat with Yagr.',
    ],
    onboardingLink: status.url,
  };
}

class WebUiGateway implements Gateway {
  private server?: Server;
  private agentHandlePromise?: Promise<YagrDeepAgentHandle>;
  private readonly setupService: YagrSetupApplicationService;
  private readonly sessionRegistry = new WebUiSessionRegistry(getYagrSessionsDir());
  private readonly deepAgentSessions = new DeepAgentSessionStore(getYagrDeepAgentSessionsDir());
  private readonly memoryStore = new MemoryStore(getYagrMemoriesDir());

  constructor(
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
      const instanceProfile = body.instanceProfile === 'yagr-managed-docker'
        || body.instanceProfile === 'yagr-managed-direct'
        || body.instanceProfile === 'custom-local-docker'
        || body.instanceProfile === 'custom-local-direct'
        || body.instanceProfile === 'custom-cloud'
        ? body.instanceProfile
        : undefined;
      const warning = await this.saveN8nConfig({
        host: String(body.host ?? ''),
        apiKey: body.apiKey ? String(body.apiKey) : undefined,
        projectId: String(body.projectId ?? ''),
        syncFolder: String(body.syncFolder ?? 'workflows'),
        instanceProfile,
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

      const { agent } = await this.resolveAgentHandle();
      this.deepAgentSessions.ensure(sessionId, {
        scope: { kind: 'webui', key: sessionId },
        title: deriveSessionTitle(message),
      });
      const result = await agent.invoke(
        { messages: [{ role: 'user', content: message }] },
        buildDeepAgentSessionConfig(sessionId),
      );

      const lastMessage = extractLastAiMessage(result);

      this.sendJson(response, 200, {
        sessionId,
        response: lastMessage,
        requiredActions: [],
        finalState: 'done',
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
      if (sessionId && isValidSessionId(sessionId)) {
        // Remove both the UI-level session metadata and the underlying
        // Deepagents thread state for this WebUI conversation.
        this.sessionRegistry.delete(sessionId);
        this.deepAgentSessions.delete(sessionId);
        this.memoryStore.delete(sessionId);
        if (this.agentHandlePromise) {
          const { checkpointer } = await this.resolveAgentHandle();
          await this.deepAgentSessions.deleteThread(checkpointer, sessionId);
        }
      }
      this.sendJson(response, 200, { ok: true });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/chat/compact') {
      // Auto-summarisation is handled natively by deepagents — this endpoint
      // is retained for API compatibility but is now a no-op.
      this.sendJson(response, 200, { compacted: false, event: null });
      return;
    }

    // -------------------------------------------------------------------------
    // Session management
    // -------------------------------------------------------------------------

    if (method === 'GET' && url.pathname === '/api/sessions') {
      const sessions: SessionSummary[] = this.sessionRegistry.list();
      this.sendJson(response, 200, { sessions });
      return;
    }

    // Create a brand-new empty session on disk so it appears in the list
    // immediately, before any message is sent.
    // Accepts an optional { id } in the body so the frontend can register
    // an existing localStorage session without requiring an ID change.
    if (method === 'POST' && url.pathname === '/api/sessions') {
      const body = await this.readJson(request);
      const providedId = typeof body.id === 'string' ? body.id : undefined;
      if (providedId !== undefined && !isValidSessionId(providedId)) {
        this.sendJson(response, 400, { error: 'Invalid session id.' });
        return;
      }
      const newId = providedId ?? randomUUID();
      if (!this.sessionRegistry.get(newId)) {
        this.sessionRegistry.createEmpty(newId);
      }
      this.deepAgentSessions.ensure(newId, {
        scope: { kind: 'webui', key: newId },
        title: 'New conversation',
      });
      this.sendJson(response, 201, { id: newId });
      return;
    }

    if (method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
      const sessionId = url.pathname.slice('/api/sessions/'.length);
      if (!isValidSessionId(sessionId)) {
        this.sendJson(response, 400, { error: 'Invalid session id.' });
        return;
      }
      const session = this.sessionRegistry.get(sessionId);
      if (!session) {
        this.sendJson(response, 404, { error: 'Session not found.' });
        return;
      }
      this.sendJson(response, 200, session);
      return;
    }

    if (method === 'DELETE' && url.pathname.startsWith('/api/sessions/')) {
      const sessionId = url.pathname.slice('/api/sessions/'.length);
      if (!isValidSessionId(sessionId)) {
        this.sendJson(response, 400, { error: 'Invalid session id.' });
        return;
      }
      this.sessionRegistry.delete(sessionId);
      this.deepAgentSessions.delete(sessionId);
      this.memoryStore.delete(sessionId);
      if (this.agentHandlePromise) {
        const { checkpointer } = await this.resolveAgentHandle();
        await this.deepAgentSessions.deleteThread(checkpointer, sessionId);
      }
      this.sendJson(response, 200, { ok: true });
      return;
    }

    // PATCH /api/sessions/:id — save rich UI display messages after each run.
    if (method === 'PATCH' && url.pathname.startsWith('/api/sessions/')) {
      const sessionId = url.pathname.slice('/api/sessions/'.length);
      if (!isValidSessionId(sessionId)) {
        this.sendJson(response, 400, { error: 'Invalid session id.' });
        return;
      }
      const body = await this.readJson(request);
      const displayMessages = body.displayMessages as SerializedChatMessage[] | undefined;
      if (!Array.isArray(displayMessages)) {
        this.sendJson(response, 400, { error: 'displayMessages must be an array.' });
        return;
      }
      this.sessionRegistry.setDisplayMessages(sessionId, displayMessages);
      this.sendJson(response, 200, { ok: true });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/n8n/workflow-session') {
      const workflowUrl = String(url.searchParams.get('url') ?? url.searchParams.get('target') ?? '').trim();
      await this.sendManagedN8nWorkflowSession(response, workflowUrl);
      return;
    }

    if (method === 'GET' && (url.pathname === '/open/n8n-workflow' || url.pathname.startsWith('/open/n8n-workflow/'))) {
      const workflowUrl = this.resolveWorkflowOpenUrl(url);
      await this.openManagedN8nWorkflow(response, workflowUrl);
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

  private async sendManagedN8nWorkflowSession(response: ServerResponse, workflowUrl: string): Promise<void> {
    if (workflowUrl.startsWith('data:text/html')) {
      this.sendJson(response, 200, { mode: 'managed', targetUrl: workflowUrl, fallbackPage: decodeHtmlDataUrl(workflowUrl) });
      return;
    }

    const session = resolveManagedN8nWorkflowOpen(workflowUrl);
    if (!session.ok) {
      this.sendJson(response, session.statusCode, { error: session.error });
      return;
    }

    this.sendJson(response, 200, session.payload);
  }

  private async openManagedN8nWorkflow(response: ServerResponse, workflowUrl: string): Promise<void> {
    if (workflowUrl.startsWith('data:text/html')) {
      this.sendText(response, 200, decodeHtmlDataUrl(workflowUrl), 'text/html; charset=utf-8');
      return;
    }

    const session = resolveManagedN8nWorkflowOpen(workflowUrl);
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

  private resolveWorkflowOpenUrl(url: URL): string {
    const token = url.pathname.startsWith('/open/n8n-workflow/')
      ? decodeURIComponent(url.pathname.slice('/open/n8n-workflow/'.length)).trim()
      : '';

    if (token) {
      return resolveStoredWorkflowOpenTarget(token);
    }

    return String(url.searchParams.get('url') ?? url.searchParams.get('target') ?? '').trim();
  }

  private async saveN8nConfig(input: {
    host: string;
    apiKey?: string;
    projectId: string;
    syncFolder: string;
    instanceProfile?: 'yagr-managed-docker' | 'yagr-managed-direct' | 'custom-local-docker' | 'custom-local-direct' | 'custom-cloud';
  }): Promise<string | undefined> {
    const warning = await this.setupService.saveN8nConfig(input);
    // Invalidate the cached agent handle so the next request picks up
    // a fresh model built from the new config.
    this.agentHandlePromise = undefined;
    return warning;
  }

  private assertProvider(value: string): YagrModelProvider {
    if (!VALID_PROVIDERS.includes(value as YagrModelProvider)) {
      throw new Error(`Unknown provider: ${value}`);
    }
    return value as YagrModelProvider;
  }

  private async resolveAgentHandle(): Promise<YagrDeepAgentHandle> {
    this.agentHandlePromise ??= createYagrDeepAgent(this.configService);
    return this.agentHandlePromise;
  }

  private persistSessionMetadata(sessionId: string): void {
    try {
      const session = this.sessionRegistry.get(sessionId);
      const memory = extractSessionMemory(
        sessionId,
        session?.title ?? 'New conversation',
        session?.createdAt ?? new Date().toISOString(),
        [],
      );
      this.memoryStore.save(memory);
    } catch {
      // Best-effort — never block the response.
    }
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

    try {
      writeEvent({ type: 'start', sessionId, message: 'Run started.' });

      const { agent } = await this.resolveAgentHandle();
      this.deepAgentSessions.ensure(sessionId, {
        scope: { kind: 'webui', key: sessionId },
        title: deriveSessionTitle(message),
      });
      const accumulator = createRunAccumulator();

      const stream = agent.streamEvents(
        { messages: [{ role: 'user', content: message }] },
        { ...buildDeepAgentSessionConfig(sessionId), signal: abortController.signal },
      );

      const lastProgressKeys = new Set<string>();
      const DEBUG_AGENT_LOOP = process.env.DEBUG_AGENT_LOOP === '1';
      let eventCount = 0;
      let lastLogTime = Date.now();

      if (DEBUG_AGENT_LOOP) {
        console.error('[DEBUG_AGENT_LOOP] Starting stream...');
      }

      for await (const event of stream) {
        eventCount++;
        const now = Date.now();
        const timeSinceLastLog = now - lastLogTime;

        if (DEBUG_AGENT_LOOP) {
          const eventName = 'name' in event ? (event.name as string) : 'unknown';
          const eventType = 'event' in event ? (event.event as string) : 'unknown';
          console.error(`[DEBUG_AGENT_LOOP] #${eventCount} event=${eventType} name=${eventName} deltaTime=${timeSinceLastLog}ms responseText.len=${accumulator.responseText.length} requiredActions=${accumulator.requiredActions.length}`);
          lastLogTime = now;
        }

        await processStreamEvent(event, accumulator, {
          onTextDelta: (delta) => {
            writeEvent({ type: 'text-delta', delta });
          },
          onOperation: (op) => {
            writeEvent({
              type: 'operation',
              operationId: op.operationId,
              label: op.label,
              category: op.category,
              status: op.status,
              body: op.body,
              summary: op.summary,
              startedAt: op.startedAt,
              endedAt: op.endedAt,
            });
          },
          onUserVisibleUpdate: (update) => {
            if (!lastProgressKeys.has(update.dedupeKey)) {
              lastProgressKeys.add(update.dedupeKey);
              writeEvent({
                type: 'progress',
                tone: update.tone,
                title: update.title,
                detail: update.detail,
                ...(update.phase ? { phase: update.phase } : {}),
              });
            }
          },
          onWorkflowEmbed: (embed) => {
            writeEvent({
              type: 'embed',
              kind: embed.kind,
              workflowId: embed.workflowId,
              url: embed.url,
              openUrl: resolvePreferredWorkflowOpenBridgeUrl(embed.url, this.status.url),
              targetUrl: embed.targetUrl,
              title: embed.title,
              diagram: embed.diagram,
              executionResult: embed.executionResult,
            });
          },
        });
      }

      if (DEBUG_AGENT_LOOP) {
        console.error(`[DEBUG_AGENT_LOOP] Stream ended. eventCount=${eventCount} responseText.len=${accumulator.responseText.length} workflowEmbeds=${accumulator.workflowEmbeds.length} requiredActions=${accumulator.requiredActions.length}`);
        console.error(`[DEBUG_AGENT_LOOP] responseText preview: ${accumulator.responseText.slice(0, 200)}`);
      }

      runFinished = true;
      this.persistSessionMetadata(sessionId);

      writeEvent({
        type: 'final',
        sessionId,
        response: accumulator.responseText,
        finalState: 'done',
        requiredActions: accumulator.requiredActions.map((a) => ({
          title: a.title,
          message: a.message,
        })),
      });
    } catch (error) {
      if (isAbortError(error)) {
        runFinished = true;
        this.persistSessionMetadata(sessionId);
        // Flush whatever text was accumulated before the abort.
        // The accumulator is in scope via the outer try block.
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
