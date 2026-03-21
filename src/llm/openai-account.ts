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

export const OPENAI_ACCOUNT_BASE_URL = 'https://chatgpt.com/backend-api';
export const OPENAI_ACCOUNT_DEFAULT_MODEL = 'gpt-5.1-codex-mini';

/** Endpoint path for Codex responses on the ChatGPT backend. */
const CODEX_RESPONSES_PATH = '/codex/responses';

/** JWT claim namespace used by OpenAI to embed ChatGPT account metadata. */
const JWT_ACCOUNT_CLAIM = 'https://api.openai.com/auth';

/** Known models served by the ChatGPT Codex backend (chatgpt.com/backend-api). */
export const KNOWN_CODEX_MODELS = [
  'gpt-5.1',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.4',
];

// ─── OAuth / PKCE constants ────────────────────────────────────────────────────

const CODEX_ISSUER = 'https://auth.openai.com';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_CALLBACK_PORT = 1455;
const CODEX_CALLBACK_PATH = '/auth/callback';
const CODEX_REDIRECT_URI = `http://localhost:${CODEX_CALLBACK_PORT}${CODEX_CALLBACK_PATH}`;
const CODEX_SCOPES = 'openid profile email offline_access';

export interface CodexAuthChallenge {
  authUrl: string;
  callbackServerStarted: boolean;
}

interface PendingCodexCallbackServer {
  expectedState: string;
  server: http.Server;
  waitForCode: Promise<{ code: string; verifier: string }>;
  timeout: NodeJS.Timeout;
}

let pendingCodexCallbackServer: PendingCodexCallbackServer | undefined;
// Survives stopCodexCallbackServer() so completeCodexAuth() can still await it.
let pendingCodexResult: Promise<{ code: string; verifier: string }> | undefined;

function generateCodexPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function stopCodexCallbackServer(): void {
  if (pendingCodexCallbackServer) {
    clearTimeout(pendingCodexCallbackServer.timeout);
    pendingCodexCallbackServer.server.close();
    pendingCodexCallbackServer = undefined;
    // Note: pendingCodexResult is intentionally NOT cleared here.
  }
}

async function startCodexCallbackServer(state: string, verifier: string): Promise<boolean> {
  stopCodexCallbackServer();

  let resolveCode: ((value: { code: string; verifier: string }) => void) | undefined;
  let rejectCode: ((error: Error) => void) | undefined;
  const waitForCode = new Promise<{ code: string; verifier: string }>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', CODEX_REDIRECT_URI);
    if (url.pathname !== CODEX_CALLBACK_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const returnedState = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error || returnedState !== state || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h3>Sign-in failed.</h3><p>Return to the terminal and try again.</p></body></html>');
      rejectCode?.(new Error(error ?? 'OAuth callback: invalid state or missing code.'));
      stopCodexCallbackServer();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body><h3>OpenAI account connected.</h3><p>You can return to the Yagr setup wizard.</p></body></html>');
    resolveCode?.({ code, verifier });
    stopCodexCallbackServer();
  });

  const timeout = setTimeout(() => {
    rejectCode?.(new Error('OpenAI OAuth callback timed out. Please retry.'));
    stopCodexCallbackServer();
  }, 3 * 60_000);

  pendingCodexCallbackServer = { expectedState: state, server, waitForCode, timeout };
  pendingCodexResult = waitForCode;

  const started = await new Promise<boolean>((resolve) => {
    server.once('error', (err) => {
      rejectCode?.(err instanceof Error ? err : new Error(String(err)));
      stopCodexCallbackServer();
      resolve(false);
    });
    server.listen(CODEX_CALLBACK_PORT, '127.0.0.1', () => resolve(true));
  });

  return started;
}

export async function beginCodexAuth(): Promise<CodexAuthChallenge> {
  const state = randomBytes(16).toString('hex');
  const { verifier, challenge } = generateCodexPkce();

  const serverStarted = await startCodexCallbackServer(state, verifier);

  const url = new URL(`${CODEX_ISSUER}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CODEX_CLIENT_ID);
  url.searchParams.set('redirect_uri', CODEX_REDIRECT_URI);
  url.searchParams.set('scope', CODEX_SCOPES);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('state', state);

  return { authUrl: url.toString(), callbackServerStarted: serverStarted };
}

export async function completeCodexAuth(): Promise<OpenAiAccountSession> {
  // The callback server may have already fired and cleared pendingCodexCallbackServer,
  // but the promise is preserved in pendingCodexResult.
  const resultPromise = pendingCodexCallbackServer?.waitForCode ?? pendingCodexResult;
  if (!resultPromise) {
    const existing = readCodexSession();
    if (existing) return existing;
    throw new Error('No pending OpenAI OAuth session. Restart the sign-in flow.');
  }
  pendingCodexResult = undefined;

  const { code, verifier } = await resultPromise;

  // Exchange code for tokens.
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', CODEX_REDIRECT_URI);
  body.set('client_id', CODEX_CLIENT_ID);
  body.set('code_verifier', verifier);

  const tokenRes = await fetch(`${CODEX_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    throw new Error(`OpenAI token exchange failed: HTTP ${tokenRes.status}`);
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };

  if (!tokens.access_token) {
    throw new Error('OpenAI token exchange returned no access_token.');
  }

  // Write ~/.codex/auth.json so the session is shared with the Codex CLI.
  const authPath = getCodexAuthPath();
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens,
    last_refresh: new Date().toISOString(),
  }, null, 2), { mode: 0o600 });

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    source: 'codex',
  };
}

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface CodexAuthFile {
  auth_mode?: string;
  last_refresh?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
}

export interface OpenAiAccountSession {
  accessToken: string;
  refreshToken?: string;
  email?: string;
  /** Always 'codex' — session is read from the Codex CLI auth file. */
  source: 'codex';
}

// ─── Path helpers ──────────────────────────────────────────────────────────────

/** Path to the Codex CLI auth file. Override with YAGR_CODEX_AUTH_PATH for tests. */
export function getCodexAuthPath(): string {
  return process.env.YAGR_CODEX_AUTH_PATH || path.join(os.homedir(), '.codex', 'auth.json');
}

// ─── Session readers ───────────────────────────────────────────────────────────

function readCodexSession(): OpenAiAccountSession | undefined {
  const authPath = getCodexAuthPath();
  if (!fs.existsSync(authPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8')) as CodexAuthFile;
    const accessToken = parsed.tokens?.access_token?.trim();
    if (!accessToken) {
      return undefined;
    }
    return {
      accessToken,
      refreshToken: parsed.tokens?.refresh_token?.trim() || undefined,
      source: 'codex',
    };
  } catch {
    return undefined;
  }
}

// ─── Public session API ────────────────────────────────────────────────────────

export function getOpenAiAccountSession(): OpenAiAccountSession | undefined {
  return readCodexSession();
}

export async function ensureOpenAiAccountSession(): Promise<OpenAiAccountSession | undefined> {
  return readCodexSession();
}

// ─── Model discovery ───────────────────────────────────────────────────────────

/** Returns the static list of models available on the ChatGPT Codex backend.
 *  The backend-api has no public `/models` endpoint, so the list is hardcoded
 *  from the known model registry. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function fetchOpenAiAccountModels(_accessToken: string): Promise<string[]> {
  return [...KNOWN_CODEX_MODELS];
}

// ─── Runtime validation ─────────────────────────────────────────────────────────

export async function validateOpenAiAccountRuntime(modelId = OPENAI_ACCOUNT_DEFAULT_MODEL): Promise<{
  ok: boolean;
  text?: string;
  error?: string;
}> {
  if (process.env.YAGR_SKIP_CODEX_RUNTIME_VALIDATION === '1') {
    return { ok: true, text: 'OK' };
  }

  const session = await ensureOpenAiAccountSession();
  if (!session) {
    return { ok: false, error: 'No OpenAI account session found.' };
  }

  try {
    const result = await runOpenAiAccountCompletion(modelId, {
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
    if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
      return { ok: true, text: 'Quota exhausted for current model; runtime endpoint is reachable.' };
    }
    return { ok: false, error: message };
  }
}

// ─── Language model ────────────────────────────────────────────────────────────

export function createOpenAiAccountLanguageModel(modelId: string): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'openai-proxy.account',
    modelId,
    defaultObjectGenerationMode: undefined,
    supportsImageUrls: false,
    supportsStructuredOutputs: false,
    async doGenerate(options) {
      const execution = await runOpenAiAccountCompletion(modelId, options);
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
      const execution = await runOpenAiAccountCompletion(modelId, options);
      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        start(controller) {
          if (execution.text) {
            controller.enqueue({ type: 'text-delta', textDelta: execution.text });
          }
          controller.enqueue({
            type: 'finish',
            finishReason: execution.finishReason,
            usage: execution.usage,
          });
          controller.close();
        },
      });
      return {
        stream,
        rawCall: {
          rawPrompt: options.prompt,
          rawSettings: { modelId },
        },
        warnings: execution.warnings,
      };
    },
  };
}

// ─── Inference (Codex Responses API via chatgpt.com/backend-api) ──────────────

async function runOpenAiAccountCompletion(
  modelId: string,
  options: Pick<LanguageModelV1CallOptions, 'prompt' | 'mode' | 'inputFormat'>,
): Promise<{
  text: string;
  finishReason: 'stop' | 'error';
  usage: { promptTokens: number; completionTokens: number };
  warnings: LanguageModelV1CallWarning[];
}> {
  const session = await ensureOpenAiAccountSession();
  if (!session) {
    throw new Error('OpenAI account session not found. Run `codex --login` to sign in.');
  }

  const warnings = buildCodexWarnings(options);
  const accountId = extractChatGptAccountId(session.accessToken);
  const { instructions, input } = convertPromptToCodexInput(options.prompt);

  const body = {
    model: modelId,
    store: false,
    stream: true,
    // The Codex backend requires a non-empty instructions field.
    instructions: instructions || 'You are a helpful assistant.',
    input,
    text: { verbosity: 'medium' },
    tool_choice: 'auto',
    parallel_tool_calls: true,
  };

  const response = await fetch(`${OPENAI_ACCOUNT_BASE_URL}${CODEX_RESPONSES_PATH}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.accessToken}`,
      'chatgpt-account-id': accountId,
      'OpenAI-Beta': 'responses=experimental',
      'originator': 'pi',
      'User-Agent': `pi (${os.platform()} ${os.release()}; ${os.arch()})`,
      'accept': 'text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText.trim() || `Codex completion failed: HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Codex completion returned empty response body.');
  }

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of parseCodexSSE(response.body)) {
    const type = typeof event.type === 'string' ? event.type : undefined;
    if (!type) continue;

    if (type === 'response.output_text.delta') {
      if (typeof event.delta === 'string') {
        text += event.delta;
      }
    } else if (type === 'response.completed') {
      const resp = event.response as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined;
      inputTokens = resp?.usage?.input_tokens ?? 0;
      outputTokens = resp?.usage?.output_tokens ?? 0;
    } else if (type === 'response.failed') {
      const resp = event.response as { error?: { message?: string } } | undefined;
      throw new Error(resp?.error?.message || 'Codex response failed.');
    } else if (type === 'error') {
      const msg = typeof event.message === 'string' ? event.message : '';
      throw new Error(msg || 'Codex stream error.');
    }
  }

  return {
    text,
    finishReason: 'stop',
    usage: { promptTokens: inputTokens, completionTokens: outputTokens },
    warnings,
  };
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function extractChatGptAccountId(token: string): string {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as Record<string, unknown>;
    const claim = payload[JWT_ACCOUNT_CLAIM] as Record<string, unknown> | undefined;
    const accountId = claim?.chatgpt_account_id;
    if (typeof accountId !== 'string' || !accountId) {
      throw new Error('No chatgpt_account_id in token');
    }
    return accountId;
  } catch {
    throw new Error('Failed to extract chatgpt_account_id from Codex token. Ensure the token was obtained via `codex --login`.');
  }
}

function convertPromptToCodexInput(prompt: LanguageModelV1Prompt): {
  instructions: string | undefined;
  input: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
} {
  let instructions: string | undefined;
  const input: Array<{ role: string; content: Array<{ type: string; text: string }> }> = [];

  for (const message of prompt) {
    if (message.role === 'system') {
      instructions = message.content;
      continue;
    }
    if (message.role === 'user') {
      const text = message.content.map((p) => p.type === 'text' ? p.text : `[${p.type}]`).join('\n');
      input.push({ role: 'user', content: [{ type: 'input_text', text }] });
    } else if (message.role === 'assistant') {
      const text = message.content.map((p) => {
        if (p.type === 'text' || p.type === 'reasoning') return p.text;
        if (p.type === 'tool-call') return `[tool-call ${p.toolName}] ${JSON.stringify(p.args)}`;
        return `[${p.type}]`;
      }).join('\n');
      input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
    }
  }

  return { instructions, input };
}

async function* parseCodexSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      if (dataLines.length > 0) {
        const data = dataLines.join('\n').trim();
        if (data && data !== '[DONE]') {
          try { yield JSON.parse(data) as Record<string, unknown>; } catch { /* skip malformed */ }
        }
      }
      idx = buffer.indexOf('\n\n');
    }
  }
}

function buildCodexWarnings(options: Pick<LanguageModelV1CallOptions, 'mode'>): LanguageModelV1CallWarning[] {
  if (options.mode.type !== 'regular' || !options.mode.tools || options.mode.tools.length === 0) {
    return [];
  }
  return options.mode.tools.map((tool) => ({
    type: 'unsupported-tool' as const,
    tool,
    details: 'openai-proxy does not expose Yagr tool-calls to the Codex backend.',
  }));
}
