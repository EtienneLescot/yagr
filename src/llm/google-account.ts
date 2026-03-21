import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1CallWarning,
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart,
} from '@ai-sdk/provider';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';

export const GEMINI_ACCOUNT_DEFAULT_MODEL = 'gemini-3-flash-preview';

const GEMINI_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GEMINI_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GEMINI_USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';
const CODE_ASSIST_CLIENT_METADATA = JSON.stringify({
  ideType: 'IDE_UNSPECIFIED',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
});
const GEMINI_REDIRECT_URI = 'http://localhost:8085/oauth2callback';
const GEMINI_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];
const GEMINI_OAUTH_PERSONAL_AUTH_TYPE = 'oauth-personal';

interface GeminiCliOauthFile {
  access_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  expiry_date?: number;
  refresh_token?: string;
}

interface GeminiStoredSession {
  provider: 'google-proxy';
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

interface GeminiOauthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface GeminiAccountSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
  projectId?: string;
}

export interface GeminiAccountAuthChallenge {
  authUrl: string;
  verifier: string;
  callbackServerStarted: boolean;
}

interface PendingGeminiCallbackServer {
  expectedState: string;
  server: http.Server;
  waitForRedirectUrl: Promise<string>;
  timeout: NodeJS.Timeout;
}

let pendingGeminiCallbackServer: PendingGeminiCallbackServer | undefined;
const completedGeminiCallbacks = new Map<string, { url: string; capturedAt: number }>();

// In-memory cache for the CodeAssist project ID (resolved once per process).
let cachedCodeAssistProjectId: string | undefined;

interface CodeAssistLoadResponse {
  currentTier?: {
    id?: string;
  };
  cloudaicompanionProject?: string;
}

interface CodeAssistGenerateResponse {
  response?: {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
}

export function getGeminiConfigDir(): string {
  return process.env.YAGR_GEMINI_CONFIG_DIR || path.join(os.homedir(), '.gemini');
}

export function getGeminiAuthPath(): string {
  return process.env.YAGR_GEMINI_AUTH_PATH || path.join(getGeminiConfigDir(), 'oauth_creds.json');
}

export function getGeminiSettingsPath(): string {
  return process.env.YAGR_GEMINI_SETTINGS_PATH || path.join(getGeminiConfigDir(), 'settings.json');
}

export function getGeminiSessionPath(): string {
  const override = process.env.YAGR_GEMINI_SESSION_PATH?.trim();
  if (override) {
    return override;
  }

  ensureYagrHomeDir();
  return path.join(getYagrPaths().accountAuthDir, 'gemini-oauth.json');
}

export function getGeminiAccountSession(): GeminiAccountSession | undefined {
  const stored = readStoredGeminiSession();
  if (!stored) {
    return undefined;
  }

  return {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    expiresAt: stored.expiresAt,
    email: stored.email,
    projectId: stored.projectId,
  };
}

export async function ensureGeminiAccountSession(): Promise<GeminiAccountSession | undefined> {
  const stored = readStoredGeminiSession();
  if (stored) {
    const refreshed = await refreshGeminiSessionIfNeeded(stored);
    syncGeminiCliFiles(refreshed);
    return {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      email: refreshed.email,
      projectId: refreshed.projectId,
    };
  }
  return undefined;
}

export function ensureGeminiCliSettings(): void {
  const settingsPath = getGeminiSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }

  if (settings.selectedAuthType !== GEMINI_OAUTH_PERSONAL_AUTH_TYPE) {
    settings.selectedAuthType = GEMINI_OAUTH_PERSONAL_AUTH_TYPE;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
}

export async function validateGeminiAccountRuntime(modelId = GEMINI_ACCOUNT_DEFAULT_MODEL): Promise<{
  ok: boolean;
  text?: string;
  error?: string;
}> {
  if (process.env.YAGR_SKIP_GEMINI_RUNTIME_VALIDATION === '1') {
    return { ok: true, text: 'OK' };
  }

  try {
    const result = await runGeminiExec(modelId, {
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly OK.' }] }],
    });
    return {
      ok: result.text.trim().toUpperCase().includes('OK'),
      text: result.text,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('HTTP 429') || message.includes('RESOURCE_EXHAUSTED')) {
      return {
        ok: true,
        text: 'Quota exhausted for current model; runtime endpoint is reachable.',
      };
    }
    return {
      ok: false,
      error: message,
    };
  }
}

// Models known to work with the CodeAssist backend via Google OAuth.
// The generativelanguage.googleapis.com/v1beta/models API is NOT accessible
// with CodeAssist OAuth scopes (cloud-platform), and there is no model listing
// endpoint on the CodeAssist API itself.  This curated list matches what
// OpenClaw ships for its google-gemini-cli provider.
const KNOWN_GEMINI_CODE_ASSIST_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-3.1-pro-preview',
];

export async function fetchGeminiOAuthModels(_accessToken: string): Promise<string[]> {
  const envOverride = process.env.YAGR_GEMINI_MODEL_LIST?.split(',').map(s => s.trim()).filter(Boolean);
  const models = envOverride && envOverride.length > 0
    ? envOverride
    : [...KNOWN_GEMINI_CODE_ASSIST_MODELS];

  if (process.env.YAGR_DEBUG_MODEL_DISCOVERY === '1') {
    process.stderr.write(`[yagr] gemini models (curated list): ${models.join(', ')}\n`);
  }

  return models;
}

export function createGeminiAccountLanguageModel(modelId: string): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'google-proxy.gemini',
    modelId,
    defaultObjectGenerationMode: undefined,
    supportsImageUrls: false,
    supportsStructuredOutputs: false,
    async doGenerate(options) {
      const execution = await runGeminiExec(modelId, options);
      return {
        text: execution.text,
        finishReason: execution.finishReason,
        usage: execution.usage,
        rawCall: {
          rawPrompt: options.prompt,
          rawSettings: { modelId },
        },
        warnings: execution.warnings,
        response: {
          timestamp: new Date(),
          modelId,
        },
      };
    },
    async doStream(options) {
      const session = await ensureGeminiAccountSession();
      if (!session) {
        throw new Error('Gemini OAuth session not found. Run `yagr setup` again.');
      }
      const warnings = buildGeminiWarnings(options);
      const project = await resolveCodeAssistProject(session);
      const { systemInstruction, contents } = convertToGeminiFormat(options.prompt);

      const abortController = new AbortController();
      const timeoutTimer = setTimeout(() => abortController.abort(), 120_000);

      let fetchResponse: Response;
      try {
        fetchResponse = await fetch(
          `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`,
          {
            method: 'POST',
            signal: abortController.signal,
            headers: {
              Authorization: `Bearer ${session.accessToken}`,
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              'User-Agent': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
              'X-Goog-Api-Client': `gl-node/${process.versions.node}`,
              'Client-Metadata': CODE_ASSIST_CLIENT_METADATA,
            },
            body: JSON.stringify({
              model: modelId,
              project,
              request: {
                ...(systemInstruction ? { systemInstruction } : {}),
                contents,
              },
              userAgent: 'yagr',
            }),
          },
        );
      } catch (error) {
        clearTimeout(timeoutTimer);
        throw error;
      }

      if (!fetchResponse.ok) {
        clearTimeout(timeoutTimer);
        const body = await fetchResponse.text().catch(() => '');
        throw formatCodeAssistError(fetchResponse.status, body, modelId);
      }

      const responseBody = fetchResponse.body;
      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        async start(controller) {
          if (!responseBody) {
            clearTimeout(timeoutTimer);
            controller.enqueue({ type: 'finish', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } });
            controller.close();
            return;
          }
          try {
            const reader = responseBody.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let promptTokens = 0;
            let completionTokens = 0;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (!data || data === '[DONE]') continue;
                try {
                  const chunk = JSON.parse(data) as CodeAssistGenerateResponse;
                  const parts = chunk.response?.candidates?.[0]?.content?.parts ?? [];
                  for (const part of parts) {
                    if (part.text) {
                      controller.enqueue({ type: 'text-delta', textDelta: part.text });
                    }
                  }
                  if (chunk.response?.usageMetadata) {
                    promptTokens = chunk.response.usageMetadata.promptTokenCount ?? promptTokens;
                    completionTokens = chunk.response.usageMetadata.candidatesTokenCount ?? completionTokens;
                  }
                } catch {
                  // Malformed SSE chunk — skip
                }
              }
            }

            clearTimeout(timeoutTimer);
            controller.enqueue({ type: 'finish', finishReason: 'stop', usage: { promptTokens, completionTokens } });
            controller.close();
          } catch (error) {
            clearTimeout(timeoutTimer);
            controller.error(error);
          }
        },
        cancel() {
          clearTimeout(timeoutTimer);
          abortController.abort();
        },
      });

      return {
        stream,
        rawCall: { rawPrompt: options.prompt, rawSettings: { modelId } },
        warnings,
      };
    },
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiConvertedPrompt {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
}

function convertToGeminiFormat(prompt: LanguageModelV1Prompt): GeminiConvertedPrompt {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];

  const push = (role: 'user' | 'model', text: string): void => {
    const last = contents[contents.length - 1];
    if (last?.role === role) {
      last.parts[0].text += '\n\n' + text;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  };

  for (const message of prompt) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }

    if (message.role === 'user') {
      const text = message.content
        .map((part) => part.type === 'text' ? part.text : `[${part.type}]`)
        .join('\n');
      push('user', text);
      continue;
    }

    if (message.role === 'assistant') {
      const text = message.content.map((part) => {
        if (part.type === 'text' || part.type === 'reasoning') return part.text;
        if (part.type === 'tool-call') return `[Calling ${part.toolName}: ${JSON.stringify(part.args)}]`;
        return `[${part.type}]`;
      }).join('\n');
      push('model', text);
      continue;
    }

    // tool messages: fold results into the user turn
    const text = message.content
      .map((part) => `[Result of ${part.toolName}]:\n${JSON.stringify(part.result)}`)
      .join('\n\n');
    push('user', text);
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: '' }] });
  }

  return {
    systemInstruction: systemParts.length > 0 ? { parts: [{ text: systemParts.join('\n\n') }] } : undefined,
    contents,
  };
}

async function runGeminiExec(
  modelId: string,
  options: Pick<LanguageModelV1CallOptions, 'prompt' | 'mode' | 'inputFormat'>,
): Promise<{
  text: string;
  finishReason: 'stop' | 'error';
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  warnings: LanguageModelV1CallWarning[];
}> {
  const session = await ensureGeminiAccountSession();
  if (!session) {
    throw new Error('Gemini OAuth session not found. Run `yagr setup` again.');
  }

  const warnings = buildGeminiWarnings(options);
  const { systemInstruction, contents } = convertToGeminiFormat(options.prompt);
  const project = await resolveCodeAssistProject(session);
  const response = await fetchWithTimeout(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:generateContent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
      'X-Goog-Api-Client': `gl-node/${process.versions.node}`,
      'Client-Metadata': CODE_ASSIST_CLIENT_METADATA,
    },
    body: JSON.stringify({
      model: modelId,
      project,
      request: {
        ...(systemInstruction ? { systemInstruction } : {}),
        contents,
      },
      userAgent: 'yagr',
    }),
  }, 30_000);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw formatCodeAssistError(response.status, body, modelId);
  }

  const payload = await response.json() as CodeAssistGenerateResponse;
  const text = payload.response?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
  return {
    text,
    finishReason: 'stop',
    usage: {
      promptTokens: payload.response?.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: payload.response?.usageMetadata?.candidatesTokenCount ?? 0,
    },
    warnings,
  };
}

export async function beginGeminiAccountAuth(): Promise<GeminiAccountAuthChallenge> {
  const credentials = resolveGeminiOAuthClientConfig();
  const { verifier, challenge } = generatePkce();
  const callbackServerStarted = await startGeminiCallbackServer(verifier);
  return {
    authUrl: buildGeminiAuthUrl(credentials.clientId, challenge, verifier),
    verifier,
    callbackServerStarted,
  };
}

export async function completeGeminiAccountAuth(callbackInput: string, verifier: string): Promise<GeminiAccountSession> {
  const credentials = resolveGeminiOAuthClientConfig();
  const resolvedInput = callbackInput.trim() || await waitForGeminiCallbackRedirect(verifier);
  const parsed = parseGeminiCallbackInput(resolvedInput, verifier);
  if ('error' in parsed) {
    throw new Error(parsed.error);
  }

  const tokenResponse = await exchangeGeminiCodeForTokens(parsed.code, verifier, credentials);
  const email = await resolveGoogleEmail(tokenResponse.access_token);
  // Resolve the CodeAssist project immediately so it is persisted in the session
  // and subsequent inference calls skip the extra loadCodeAssist round-trip.
  let projectId: string | undefined;
  try {
    projectId = await loadGeminiCodeAssistProject(tokenResponse.access_token);
    cachedCodeAssistProjectId = projectId;
  } catch {
    // Non-fatal: will be resolved lazily on first inference call.
  }
  const nowIso = new Date().toISOString();
  const stored: GeminiStoredSession = {
    provider: 'google-proxy',
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || '',
    expiresAt: Date.now() + tokenResponse.expires_in * 1000 - 5 * 60 * 1000,
    email,
    projectId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (!stored.refreshToken) {
    throw new Error('No refresh token received from Google OAuth. Retry the consent flow.');
  }

  writeStoredGeminiSession(stored);
  syncGeminiCliFiles(stored);
  return {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    expiresAt: stored.expiresAt,
    email: stored.email,
    projectId: stored.projectId,
  };
}

async function startGeminiCallbackServer(expectedState: string): Promise<boolean> {
  stopGeminiCallbackServer();

  let resolveRedirect: ((value: string) => void) | undefined;
  let rejectRedirect: ((error: Error) => void) | undefined;
  const waitForRedirectUrl = new Promise<string>((resolve, reject) => {
    resolveRedirect = resolve;
    rejectRedirect = reject;
  });

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', GEMINI_REDIRECT_URI);
    if (requestUrl.pathname !== '/oauth2callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const state = requestUrl.searchParams.get('state');
    const code = requestUrl.searchParams.get('code');
    const oauthError = requestUrl.searchParams.get('error');

    if (oauthError) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`OAuth error: ${oauthError}. Return to terminal and retry.`);
      storeCompletedGeminiCallback(expectedState, requestUrl.toString());
      resolveRedirect?.(requestUrl.toString());
      stopGeminiCallbackServer();
      return;
    }

    if (!code || state !== expectedState) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Invalid callback. Return to terminal and retry.');
      storeCompletedGeminiCallback(expectedState, requestUrl.toString());
      resolveRedirect?.(requestUrl.toString());
      stopGeminiCallbackServer();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body><h3>Gemini account connected.</h3><p>You can return to Yagr.</p></body></html>');
    storeCompletedGeminiCallback(expectedState, requestUrl.toString());
    resolveRedirect?.(requestUrl.toString());
    stopGeminiCallbackServer();
  });

  const timeout = setTimeout(() => {
    rejectRedirect?.(new Error('Gemini OAuth callback timeout. Retry and complete sign-in in the browser.'));
    stopGeminiCallbackServer();
  }, 3 * 60_000);

  pendingGeminiCallbackServer = {
    expectedState,
    server,
    waitForRedirectUrl,
    timeout,
  };

  const listenResult = await new Promise<boolean>((resolve) => {
    server.once('error', (error) => {
      rejectRedirect?.(error instanceof Error ? error : new Error(String(error)));
      stopGeminiCallbackServer();
      resolve(false);
    });
    server.listen(8085, () => {
      resolve(true);
    });
  });

  return listenResult;
}

async function waitForGeminiCallbackRedirect(expectedState: string): Promise<string> {
  const completed = completedGeminiCallbacks.get(expectedState);
  if (completed) {
    completedGeminiCallbacks.delete(expectedState);
    return completed.url;
  }

  const pending = pendingGeminiCallbackServer;
  if (!pending || pending.expectedState !== expectedState) {
    throw new Error('Gemini callback listener is not active. Paste the redirect URL manually.');
  }
  return await pending.waitForRedirectUrl;
}

function stopGeminiCallbackServer(): void {
  const pending = pendingGeminiCallbackServer;
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  pendingGeminiCallbackServer = undefined;
  try {
    pending.server.close();
  } catch {
    // Ignore close errors.
  }
}

function storeCompletedGeminiCallback(state: string, url: string): void {
  pruneCompletedGeminiCallbacks();
  completedGeminiCallbacks.set(state, { url, capturedAt: Date.now() });
}

function pruneCompletedGeminiCallbacks(): void {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [state, callback] of completedGeminiCallbacks.entries()) {
    if (callback.capturedAt < cutoff) {
      completedGeminiCallbacks.delete(state);
    }
  }
}

async function refreshGeminiSessionIfNeeded(session: GeminiStoredSession): Promise<GeminiStoredSession> {
  if (session.expiresAt - Date.now() > 60_000) {
    return session;
  }

  const credentials = resolveGeminiOAuthClientConfig();
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  });
  if (credentials.clientSecret) {
    body.set('client_secret', credentials.clientSecret);
  }

  const response = await fetch(GEMINI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: '*/*',
      'User-Agent': 'google-api-nodejs-client/9.15.1',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Gemini token refresh failed: ${await response.text()}`);
  }

  const data = await response.json() as GeminiOauthTokenResponse;
  const refreshed: GeminiStoredSession = {
    ...session,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    updatedAt: new Date().toISOString(),
  };
  writeStoredGeminiSession(refreshed);
  return refreshed;
}

function readStoredGeminiSession(): GeminiStoredSession | undefined {
  const sessionPath = getGeminiSessionPath();
  if (!fs.existsSync(sessionPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as GeminiStoredSession;
    if (!parsed.accessToken || !parsed.refreshToken) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function writeStoredGeminiSession(session: GeminiStoredSession): void {
  const sessionPath = getGeminiSessionPath();
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

function syncGeminiCliFiles(session: GeminiAccountSession): void {
  const authPath = getGeminiAuthPath();
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  const payload: GeminiCliOauthFile = {
    access_token: session.accessToken,
    scope: GEMINI_SCOPES.join(' '),
    token_type: 'Bearer',
    expiry_date: session.expiresAt,
    refresh_token: session.refreshToken,
  };
  fs.writeFileSync(authPath, JSON.stringify(payload, null, 2));
  ensureGeminiCliSettings();
}

function resolveGeminiOAuthClientConfig(): { clientId: string; clientSecret?: string } {
  const envClientId = process.env.YAGR_GEMINI_OAUTH_CLIENT_ID?.trim()
    || process.env.OPENCLAW_GEMINI_OAUTH_CLIENT_ID?.trim()
    || process.env.GEMINI_CLI_OAUTH_CLIENT_ID?.trim();
  const envClientSecret = process.env.YAGR_GEMINI_OAUTH_CLIENT_SECRET?.trim()
    || process.env.OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET?.trim()
    || process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET?.trim();
  if (envClientId) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret || undefined,
    };
  }

  const extracted = extractGeminiCliCredentials();
  if (extracted) {
    return extracted;
  }

  throw new Error(
    'Gemini OAuth client credentials could not be resolved. Install Gemini CLI or set YAGR_GEMINI_OAUTH_CLIENT_ID.',
  );
}

function extractGeminiCliCredentials(): { clientId: string; clientSecret: string } | null {
  const geminiPath = findGeminiExecutablePath();
  if (!geminiPath) {
    return null;
  }

  const resolvedGeminiPath = safeRealpath(geminiPath);
  const binDir = path.dirname(geminiPath);
  const candidateDirs = dedupePaths([
    path.dirname(path.dirname(resolvedGeminiPath)),
    path.join(path.dirname(resolvedGeminiPath), 'node_modules', '@google', 'gemini-cli'),
    path.join(binDir, 'node_modules', '@google', 'gemini-cli'),
    path.join(path.dirname(binDir), 'node_modules', '@google', 'gemini-cli'),
    path.join(path.dirname(binDir), 'lib', 'node_modules', '@google', 'gemini-cli'),
  ]);

  const candidatePaths: string[] = [];
  for (const dir of candidateDirs) {
    candidatePaths.push(
      path.join(dir, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'src', 'code_assist', 'oauth2.js'),
      path.join(dir, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'code_assist', 'oauth2.js'),
    );
  }

  for (const candidate of candidatePaths) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const content = fs.readFileSync(candidate, 'utf8');
    const clientId = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/)?.[1];
    const clientSecret = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/)?.[1];
    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
  }

  return null;
}

function findGeminiExecutablePath(): string | undefined {
  const executable = process.env.YAGR_GEMINI_CLI_PATH?.trim();
  if (executable && fs.existsSync(executable)) {
    return executable;
  }

  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const executableName of ['gemini', 'gemini.cmd', 'gemini.bat', 'gemini.exe']) {
      const candidate = path.join(directory, executableName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function safeRealpath(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return value;
  }
}

function dedupePaths(paths: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const entry of paths) {
    const key = process.platform === 'win32' ? entry.replace(/\\/g, '/').toLowerCase() : entry;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildGeminiAuthUrl(clientId: string, challenge: string, verifier: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: GEMINI_REDIRECT_URI,
    scope: GEMINI_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: verifier,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${GEMINI_AUTH_URL}?${params.toString()}`;
}

function parseGeminiCallbackInput(
  input: string,
  expectedState: string,
): { code: string; state: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: 'No input provided.' };
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') ?? expectedState;
    if (!code) {
      return { error: 'Missing code parameter in redirect URL.' };
    }
    if (state !== expectedState) {
      return { error: 'OAuth state mismatch.' };
    }
    return { code, state };
  } catch {
    return { error: 'Paste the full redirect URL, not only the code.' };
  }
}

async function exchangeGeminiCodeForTokens(
  code: string,
  verifier: string,
  credentials: { clientId: string; clientSecret?: string },
): Promise<GeminiOauthTokenResponse> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    code,
    grant_type: 'authorization_code',
    redirect_uri: GEMINI_REDIRECT_URI,
    code_verifier: verifier,
  });
  if (credentials.clientSecret) {
    body.set('client_secret', credentials.clientSecret);
  }

  const response = await fetch(GEMINI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: '*/*',
      'User-Agent': 'google-api-nodejs-client/9.15.1',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Gemini token exchange failed: ${await response.text()}`);
  }

  return await response.json() as GeminiOauthTokenResponse;
}

async function resolveGoogleEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch(GEMINI_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      return undefined;
    }
    const payload = await response.json() as Record<string, unknown>;
    return typeof payload.email === 'string' ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

function buildGeminiWarnings(options: Pick<LanguageModelV1CallOptions, 'mode'>): LanguageModelV1CallWarning[] {
  if (options.mode.type !== 'regular' || !options.mode.tools || options.mode.tools.length === 0) {
    return [];
  }

  return options.mode.tools.map((tool) => ({
    type: 'unsupported-tool',
    tool,
    details: 'Gemini OAuth currently executes through Code Assist runtime and does not expose Yagr tool-calls yet.',
  }));
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCodeAssistProject(session: GeminiAccountSession): Promise<string> {
  // Return from in-memory cache (fastest)
  if (cachedCodeAssistProjectId) {
    return cachedCodeAssistProjectId;
  }
  // Return from stored session (avoids network call)
  if (session.projectId) {
    cachedCodeAssistProjectId = session.projectId;
    return session.projectId;
  }
  // Fetch from API (first time only)
  const project = await loadGeminiCodeAssistProject(session.accessToken);
  cachedCodeAssistProjectId = project;
  // Persist in session so future processes skip the API call too
  const stored = readStoredGeminiSession();
  if (stored && !stored.projectId) {
    stored.projectId = project;
    writeStoredGeminiSession(stored);
  }
  return project;
}

async function loadGeminiCodeAssistProject(accessToken: string): Promise<string> {
  const metadata = {
    ideType: 'IDE_UNSPECIFIED' as const,
    platform: 'PLATFORM_UNSPECIFIED' as const,
    pluginType: 'GEMINI' as const,
  };
  const response = await fetchWithTimeout(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'google-api-nodejs-client/9.15.1',
      'X-Goog-Api-Client': `gl-node/${process.versions.node}`,
      'Client-Metadata': JSON.stringify(metadata),
    },
    body: JSON.stringify({ metadata }),
  }, 8_000);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini Code Assist load failed (HTTP ${response.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }

  const payload = await response.json() as CodeAssistLoadResponse;
  const project = payload.cloudaicompanionProject?.trim();
  if (!project) {
    throw new Error('Gemini Code Assist did not return a project id.');
  }
  return project;
}

function formatCodeAssistError(status: number, body: string, modelId: string): Error {
  if (status === 429) {
    const resetMatch = body.match(/reset after (\d+)s/);
    const resetHint = resetMatch ? ` (resets in ${resetMatch[1]}s)` : '';
    return new Error(
      `Rate limit exceeded for model "${modelId}"${resetHint}. ` +
      'The Gemini free tier has strict per-model quotas. Wait a moment or try a different model.',
    );
  }
  if (status === 404) {
    return new Error(
      `Model "${modelId}" is not available on your Gemini account. ` +
      'It may not be supported for your tier or region. Choose a different model.',
    );
  }
  return new Error(
    `Gemini Code Assist request failed (HTTP ${status})${body ? `: ${body.slice(0, 200)}` : ''}`,
  );
}
