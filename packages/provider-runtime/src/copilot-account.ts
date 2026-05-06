import fs from 'node:fs';
import path from 'node:path';
import { ensureYagrHomeDir, getYagrPaths } from './config/yagr-home.js';
import { getCachedProviderModelMetadata, primeProviderModelMetadata } from './provider-metadata.js';

export const DEFAULT_COPILOT_API_BASE_URL = 'https://api.individual.githubcopilot.com';
export const GITHUB_COPILOT_DEFAULT_MODEL = 'gpt-4.1';

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const COPILOT_USER_AGENT = 'GitHubCopilotChat/0.26.7';
const COPILOT_EDITOR_VERSION = 'vscode/1.96.2';
const COPILOT_EDITOR_PLUGIN_VERSION = 'copilot-chat/0.26.7';

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

  const imported = importGitHubCliSession();
  if (imported) {
    return {
      githubToken: imported.githubToken,
      source: 'gh-cli',
    };
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

  const copilotSession = getGitHubCopilotSession();
  if (!copilotSession) {
    return { ok: false, error: 'No GitHub Copilot session found.' };
  }

  try {
    const runtimeAuth = await resolveCopilotApiToken(copilotSession.githubToken);
    const response = await fetch(`${runtimeAuth.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeAuth.token}`,
        'Content-Type': 'application/json',
        'User-Agent': COPILOT_USER_AGENT,
        'Editor-Version': COPILOT_EDITOR_VERSION,
        'Editor-Plugin-Version': COPILOT_EDITOR_PLUGIN_VERSION,
        'Copilot-Integration-Id': 'vscode-chat',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
        max_tokens: 16,
      }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '';
    return { ok: text.trim().toUpperCase().includes('OK'), text };
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
      'User-Agent': COPILOT_USER_AGENT,
      'Editor-Version': COPILOT_EDITOR_VERSION,
      'Editor-Plugin-Version': COPILOT_EDITOR_PLUGIN_VERSION,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const detail = body.trim();
    throw new Error(detail || `GitHub Copilot model discovery failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as { data?: Array<{ id?: string }> };
  const models = (payload.data ?? [])
    .map((entry) => entry.id?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .sort((a, b) => a.localeCompare(b));
  return [...new Set(models)];
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

function importGitHubCliSession(): GitHubStoredSession | undefined {
  const hostsPath = process.env.YAGR_GH_HOSTS_PATH?.trim() || path.join(process.env.HOME || '', '.config', 'gh', 'hosts.yml');
  if (!hostsPath || !fs.existsSync(hostsPath)) {
    return undefined;
  }

  try {
    const content = fs.readFileSync(hostsPath, 'utf8');
    const githubComBlock = extractYamlTopLevelBlock(content, 'github.com');
    if (!githubComBlock) {
      return undefined;
    }

    const token = extractYamlScalar(githubComBlock, 'oauth_token')?.trim();
    if (!token) {
      return undefined;
    }

    const nowIso = new Date().toISOString();
    const imported: GitHubStoredSession = {
      provider: 'copilot-proxy',
      githubToken: token,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    writeStoredGitHubSession(imported);
    process.stderr.write(`[yagr] Imported GitHub CLI session from ${hostsPath}\n`);
    return imported;
  } catch {
    return undefined;
  }
}

function extractYamlTopLevelBlock(content: string, key: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const blockLines: string[] = [];
  let inside = false;

  for (const line of lines) {
    if (!inside) {
      if (line.trim() === `${key}:`) {
        inside = true;
      }
      continue;
    }

    if (line.trim().length === 0) {
      blockLines.push(line);
      continue;
    }

    if (!/^\s/.test(line)) {
      break;
    }

    blockLines.push(line);
  }

  return blockLines.length > 0 ? blockLines.join('\n') : undefined;
}

function extractYamlScalar(content: string, key: string): string | undefined {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.+?)\\s*$`, 'm');
  const match = content.match(pattern);
  if (!match) {
    return undefined;
  }

  const value = match[1].trim();
  return value.replace(/^['"]|['"]$/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
