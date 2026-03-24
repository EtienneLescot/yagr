import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV1 } from '@ai-sdk/provider';
import type { YagrModelCapabilityProfile } from './model-capabilities.js';

export const ANTHROPIC_ACCOUNT_DEFAULT_MODEL = 'claude-sonnet-4-5';

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface ClaudeCodeConfig {
  /** API key stored directly (e.g. from `claude config set apiKey ...`). */
  primaryApiKey?: string;
  /** OAuth account credentials stored by `claude` login flow. */
  oauthAccount?: {
    emailAddress?: string;
    tokenData?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: string | number;
    };
  };
}

export interface AnthropicAccountSession {
  /** Bearer token for the Anthropic API (API key or OAuth access token). */
  apiKey: string;
  email?: string;
  /** Where the credential came from. */
  source: 'env' | 'claude-config';
}

// ─── Path helpers ──────────────────────────────────────────────────────────────

export function getClaudeConfigPath(): string {
  return process.env.YAGR_CLAUDE_CONFIG_PATH || path.join(os.homedir(), '.claude', 'config.json');
}

// ─── Session reader ────────────────────────────────────────────────────────────

export function getAnthropicAccountSession(): AnthropicAccountSession | undefined {
  const yagrToken = process.env.YAGR_ANTHROPIC_SETUP_TOKEN?.trim();
  if (yagrToken) {
    return { apiKey: yagrToken, source: 'env' };
  }

  // 1. Environment variable (highest priority, e.g. CI or explicit override).
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) {
    return { apiKey: envKey, source: 'env' };
  }

  // 2. Claude Code config file (~/.claude/config.json).
  const configPath = getClaudeConfigPath();
  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ClaudeCodeConfig;

    // API key stored in Claude Code config.
    const primaryApiKey = config.primaryApiKey?.trim();
    if (primaryApiKey) {
      return { apiKey: primaryApiKey, source: 'claude-config' };
    }

    // OAuth access token from Claude Code account login.
    const oauthToken = config.oauthAccount?.tokenData?.accessToken?.trim();
    if (oauthToken) {
      return {
        apiKey: oauthToken,
        email: config.oauthAccount?.emailAddress,
        source: 'claude-config',
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export async function ensureAnthropicAccountSession(): Promise<AnthropicAccountSession | undefined> {
  return getAnthropicAccountSession();
}

// ─── Model discovery ───────────────────────────────────────────────────────────

export async function fetchAnthropicAccountModels(apiKey: string): Promise<string[]> {
  const response = await fetch('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Anthropic account model discovery failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as { data?: Array<{ id?: string }> };
  const models = (payload.data ?? [])
    .map((entry) => entry.id?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .sort((a, b) => a.localeCompare(b));
  return [...new Set(models)];
}

// ─── Runtime validation ─────────────────────────────────────────────────────────

export async function validateAnthropicAccountRuntime(
  modelId = ANTHROPIC_ACCOUNT_DEFAULT_MODEL,
  overrideApiKey?: string,
): Promise<{
  ok: boolean;
  text?: string;
  error?: string;
}> {
  if (process.env.YAGR_SKIP_ANTHROPIC_RUNTIME_VALIDATION === '1') {
    return { ok: true, text: 'OK' };
  }

  const session = await ensureAnthropicAccountSession();
  const apiKey = overrideApiKey?.trim() || session?.apiKey;
  if (!apiKey) {
    return { ok: false, error: 'No Anthropic account credentials found. Install Claude Code or set ANTHROPIC_API_KEY.' };
  }

  try {
    const model = createAnthropicAccountLanguageModel(modelId, apiKey);
    const result = await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly OK.' }] }],
    });
    return {
      ok: (result.text ?? '').trim().toUpperCase().includes('OK'),
      text: result.text,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('429') || message.includes('overloaded') || message.includes('rate')) {
      return { ok: true, text: 'Rate limited but endpoint reachable.' };
    }
    return { ok: false, error: message };
  }
}

// ─── Language model ────────────────────────────────────────────────────────────

export function createAnthropicAccountLanguageModel(
  modelId: string,
  overrideApiKey?: string,
  _capabilityProfile?: YagrModelCapabilityProfile,
): LanguageModelV1 {
  const session = getAnthropicAccountSession();
  const apiKey = overrideApiKey?.trim() || session?.apiKey;
  if (!apiKey) {
    throw new Error(
      'Anthropic account credentials not found. '
      + 'Install Claude Code CLI (`claude`) and sign in, or set ANTHROPIC_API_KEY.',
    );
  }

  return createAnthropic({ apiKey })(modelId);
}
