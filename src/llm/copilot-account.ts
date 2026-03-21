import fs from 'node:fs';
import path from 'node:path';
import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1CallWarning,
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart,
} from '@ai-sdk/provider';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';

export const DEFAULT_COPILOT_API_BASE_URL = 'https://api.individual.githubcopilot.com';
export const GITHUB_COPILOT_DEFAULT_MODEL = 'gpt-4.1';

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

interface GitHubStoredSession {
  provider: 'copilot-proxy';
  githubToken: string;
  createdAt: string;
  updatedAt: string;
}

interface CachedCopilotToken {
  token: string;
  expiresAt: number;
  updatedAt: number;
}

interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

type GitHubDeviceTokenResponse =
  | {
    access_token: string;
    token_type: string;
    scope?: string;
  }
  | {
    error: string;
    error_description?: string;
  };

export interface GitHubCopilotSession {
  githubToken: string;
  source: string;
}

export interface GitHubCopilotAuthChallenge {
  verificationUri: string;
  userCode: string;
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
}

export function getGitHubCopilotSession(): GitHubCopilotSession | undefined {
  const envToken = readOptionalString(process.env.COPILOT_GITHUB_TOKEN)
    || readOptionalString(process.env.GH_TOKEN)
    || readOptionalString(process.env.GITHUB_TOKEN);
  if (envToken) {
    return {
      githubToken: envToken,
      source: 'env',
    };
  }

  const stored = readStoredGitHubSession();
  if (!stored) {
    return undefined;
  }

  return {
    githubToken: stored.githubToken,
    source: 'yagr',
  };
}

export async function ensureGitHubCopilotSession(): Promise<GitHubCopilotSession | undefined> {
  const existing = getGitHubCopilotSession();
  if (existing) {
    return existing;
  }
  return undefined;
}

export async function resolveCopilotApiToken(githubToken: string): Promise<{
  token: string;
  expiresAt: number;
  baseUrl: string;
}> {
  const cachePath = getCopilotTokenCachePath();
  const cached = readCachedCopilotToken(cachePath);
  if (cached && isCopilotTokenUsable(cached)) {
    return {
      token: cached.token,
      expiresAt: cached.expiresAt,
      baseUrl: deriveCopilotApiBaseUrlFromToken(cached.token) ?? DEFAULT_COPILOT_API_BASE_URL,
    };
  }

  const response = await fetch(COPILOT_TOKEN_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${githubToken}`,
      'User-Agent': 'GitHubCopilotChat/0.26.7',
    },
  });

  if (!response.ok) {
    throw new Error(`Copilot token exchange failed: HTTP ${response.status}`);
  }

  const payload = parseCopilotTokenResponse(await response.json());
  writeCachedCopilotToken(cachePath, {
    token: payload.token,
    expiresAt: payload.expiresAt,
    updatedAt: Date.now(),
  });

  return {
    token: payload.token,
    expiresAt: payload.expiresAt,
    baseUrl: deriveCopilotApiBaseUrlFromToken(payload.token) ?? DEFAULT_COPILOT_API_BASE_URL,
  };
}

export async function validateGitHubCopilotRuntime(modelId = GITHUB_COPILOT_DEFAULT_MODEL): Promise<{
  ok: boolean;
  text?: string;
  error?: string;
}> {
  if (process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION === '1') {
    return { ok: true, text: 'OK' };
  }

  try {
    const result = await runGitHubCopilotCompletion(modelId, {
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly OK.' }] }],
    });
    return {
      ok: result.text.trim().toUpperCase().includes('OK'),
      text: result.text,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchGitHubCopilotModels(token: string, baseUrl = DEFAULT_COPILOT_API_BASE_URL): Promise<string[]> {
  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub Copilot model discovery failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as { data?: Array<{ id?: string }> };
  const models = (payload.data ?? [])
    .map((entry) => entry.id?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .sort((a, b) => a.localeCompare(b));
  return [...new Set(models)];
}

export function createGitHubCopilotLanguageModel(modelId: string): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'copilot-proxy.github',
    modelId,
    defaultObjectGenerationMode: undefined,
    supportsImageUrls: false,
    supportsStructuredOutputs: false,
    async doGenerate(options) {
      const execution = await runGitHubCopilotCompletion(modelId, options);
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
      const execution = await runGitHubCopilotCompletion(modelId, options);
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

async function runGitHubCopilotCompletion(
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
  const session = await ensureGitHubCopilotSession();
  if (!session) {
    throw new Error('GitHub Copilot OAuth session not found. Run `yagr setup` again.');
  }

  const runtimeAuth = await resolveCopilotApiToken(session.githubToken);
  const warnings = buildCopilotWarnings(options);
  const response = await fetch(`${runtimeAuth.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtimeAuth.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
    },
    body: JSON.stringify({
      model: modelId,
      messages: toOpenAiMessages(options.prompt),
      stream: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body.trim() || `GitHub Copilot chat completion failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  return {
    text: extractCopilotText(payload),
    finishReason: 'stop',
    usage: extractOpenAiUsage(payload),
    warnings,
  };
}

export async function beginGitHubCopilotAuth(): Promise<GitHubCopilotAuthChallenge> {
  const device = await requestDeviceCode();
  return {
    verificationUri: device.verification_uri,
    userCode: device.user_code,
    deviceCode: device.device_code,
    intervalMs: Math.max(1000, device.interval * 1000),
    expiresAt: Date.now() + device.expires_in * 1000,
  };
}

export async function completeGitHubCopilotAuth(challenge: {
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
}): Promise<GitHubCopilotSession> {
  const githubToken = await pollForAccessToken(challenge);
  const stored: GitHubStoredSession = {
    provider: 'copilot-proxy',
    githubToken,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeStoredGitHubSession(stored);
  return {
    githubToken: stored.githubToken,
    source: 'yagr',
  };
}

async function requestDeviceCode(): Promise<GitHubDeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope: 'read:user',
  });

  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`GitHub device code failed: HTTP ${response.status}`);
  }

  return await response.json() as GitHubDeviceCodeResponse;
}

async function pollForAccessToken(params: {
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    device_code: params.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  while (Date.now() < params.expiresAt) {
    const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`GitHub access token failed: HTTP ${response.status}`);
    }

    const payload = await response.json() as GitHubDeviceTokenResponse;
    if ('access_token' in payload && typeof payload.access_token === 'string') {
      return payload.access_token;
    }

    const error = 'error' in payload ? payload.error : 'unknown';
    if (error === 'authorization_pending') {
      await delay(params.intervalMs);
      continue;
    }
    if (error === 'slow_down') {
      await delay(params.intervalMs + 2000);
      continue;
    }
    if (error === 'access_denied') {
      throw new Error('GitHub login cancelled.');
    }
    if (error === 'expired_token') {
      throw new Error('GitHub device code expired. Retry setup.');
    }
    throw new Error(`GitHub device flow error: ${error}`);
  }

  throw new Error('GitHub device code expired. Retry setup.');
}

function getGitHubSessionPath(): string {
  const override = process.env.YAGR_COPILOT_SESSION_PATH?.trim();
  if (override) {
    return override;
  }

  ensureYagrHomeDir();
  return path.join(getYagrPaths().accountAuthDir, 'copilot-oauth.json');
}

function readStoredGitHubSession(): GitHubStoredSession | undefined {
  const sessionPath = getGitHubSessionPath();
  if (!fs.existsSync(sessionPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as GitHubStoredSession;
    return parsed.githubToken ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredGitHubSession(session: GitHubStoredSession): void {
  const sessionPath = getGitHubSessionPath();
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

function getCopilotTokenCachePath(): string {
  const override = readOptionalString(process.env.YAGR_COPILOT_TOKEN_CACHE_PATH);
  if (override) {
    return override;
  }

  ensureYagrHomeDir();
  return path.join(getYagrPaths().accountAuthDir, 'copilot-runtime-token.json');
}

function readCachedCopilotToken(cachePath: string): CachedCopilotToken | undefined {
  if (!fs.existsSync(cachePath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CachedCopilotToken;
  } catch {
    return undefined;
  }
}

function writeCachedCopilotToken(cachePath: string, token: CachedCopilotToken): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(token, null, 2));
}

function isCopilotTokenUsable(cache: CachedCopilotToken, now = Date.now()): boolean {
  return cache.expiresAt - now > 5 * 60 * 1000;
}

function parseCopilotTokenResponse(value: unknown): { token: string; expiresAt: number } {
  if (!value || typeof value !== 'object') {
    throw new Error('Unexpected response from GitHub Copilot token endpoint');
  }

  const record = value as Record<string, unknown>;
  const token = readOptionalString(record.token);
  const expiresAt = normalizeEpochMillis(record.expires_at);
  if (!token || !expiresAt) {
    throw new Error('Invalid Copilot token response.');
  }

  return { token, expiresAt };
}

export function deriveCopilotApiBaseUrlFromToken(token: string): string | null {
  const match = token.trim().match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  const proxyEndpoint = match?.[1]?.trim();
  if (!proxyEndpoint) {
    return null;
  }

  const host = proxyEndpoint.replace(/^https?:\/\//, '').replace(/^proxy\./i, 'api.');
  return host ? `https://${host}` : null;
}

function buildCopilotWarnings(options: Pick<LanguageModelV1CallOptions, 'mode'>): LanguageModelV1CallWarning[] {
  if (options.mode.type !== 'regular' || !options.mode.tools || options.mode.tools.length === 0) {
    return [];
  }

  return options.mode.tools.map((tool) => ({
    type: 'unsupported-tool',
    tool,
    details: 'GitHub Copilot OAuth currently uses a text-only OpenAI-compatible runtime and does not expose Yagr tool-calls yet.',
  }));
}

function toOpenAiMessages(prompt: LanguageModelV1Prompt): Array<{ role: string; content: string }> {
  return prompt.map((message) => ({
    role: message.role === 'tool' ? 'user' : message.role,
    content: flattenPromptPart(message),
  }));
}

function flattenPromptPart(message: LanguageModelV1Prompt[number]): string {
  if (message.role === 'system') {
    return message.content;
  }
  if (message.role === 'user') {
    return message.content.map((part) => part.type === 'text' ? part.text : `[${part.type}]`).join('\n');
  }
  if (message.role === 'assistant') {
    return message.content.map((part) => {
      if (part.type === 'text' || part.type === 'reasoning') {
        return part.text;
      }
      if (part.type === 'tool-call') {
        return `[tool-call ${part.toolName}] ${JSON.stringify(part.args)}`;
      }
      return `[${part.type}]`;
    }).join('\n');
  }
  return message.content.map((part) => `[tool-result ${part.toolName}] ${JSON.stringify(part.result)}`).join('\n');
}

function extractCopilotText(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }

  const firstChoice = choices[0] as Record<string, unknown>;
  const message = firstChoice.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'object' && part && typeof (part as Record<string, unknown>).text === 'string'
      ? (part as Record<string, string>).text
      : '').join('');
  }
  return '';
}

function extractOpenAiUsage(payload: Record<string, unknown>): { promptTokens: number; completionTokens: number } {
  const usage = payload.usage as Record<string, unknown> | undefined;
  return {
    promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
    completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0,
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeEpochMillis(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed > 10_000_000_000 ? parsed : parsed * 1000;
    }
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
