import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const OPENAI_ACCOUNT_BASE_URL = 'https://chatgpt.com/backend-api';
export const OPENAI_ACCOUNT_DEFAULT_MODEL = 'gpt-5.4';
export const OPENAI_ACCOUNT_MODEL_CATALOG = Object.freeze([
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex-max',
]);

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
  accountId?: string;
  authMode?: string;
  lastRefresh?: string;
}

export function getCodexAuthPath(): string {
  return process.env.YAGR_CODEX_AUTH_PATH || path.join(os.homedir(), '.codex', 'auth.json');
}

export function getOpenAiAccountSession(): OpenAiAccountSession | undefined {
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
      accountId: parsed.tokens?.account_id?.trim() || undefined,
      authMode: parsed.auth_mode,
      lastRefresh: parsed.last_refresh,
    };
  } catch {
    return undefined;
  }
}

export async function ensureOpenAiAccountSession(): Promise<OpenAiAccountSession | undefined> {
  const existingSession = getOpenAiAccountSession();
  if (existingSession) {
    return existingSession;
  }

  const loginSucceeded = await runCodexLogin();
  if (!loginSucceeded) {
    return undefined;
  }

  return getOpenAiAccountSession();
}

async function runCodexLogin(): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn('codex', ['--login'], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}
