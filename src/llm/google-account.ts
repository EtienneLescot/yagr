import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1CallWarning,
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart,
} from '@ai-sdk/provider';

export const GEMINI_ACCOUNT_DEFAULT_MODEL = 'gemini-2.5-pro';
export const GEMINI_ACCOUNT_MODEL_CATALOG = Object.freeze([
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
]);

interface GeminiOauthFile {
  token?: string;
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number | string;
  expires_at?: number | string;
  email?: string;
}

export interface GeminiAccountSession {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
  authPath: string;
}

const GEMINI_OAUTH_PERSONAL_AUTH_TYPE = 'oauth-personal';

export function getGeminiConfigDir(): string {
  return process.env.YAGR_GEMINI_CONFIG_DIR || path.join(os.homedir(), '.gemini');
}

export function getGeminiAuthPath(): string {
  return process.env.YAGR_GEMINI_AUTH_PATH || path.join(getGeminiConfigDir(), 'oauth_creds.json');
}

export function getGeminiSettingsPath(): string {
  return process.env.YAGR_GEMINI_SETTINGS_PATH || path.join(getGeminiConfigDir(), 'settings.json');
}

function getGeminiExecutable(): string {
  return process.env.YAGR_GEMINI_CLI_PATH || 'gemini';
}

export function getGeminiAccountSession(): GeminiAccountSession | undefined {
  const authPath = getGeminiAuthPath();
  if (!fs.existsSync(authPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8')) as GeminiOauthFile;
    const accessToken = readOptionalString(parsed.access_token) || readOptionalString(parsed.token);
    const refreshToken = readOptionalString(parsed.refresh_token);
    const expiresAt = normalizeEpochMillis(parsed.expiry_date ?? parsed.expires_at);
    if (!accessToken && !refreshToken) {
      return undefined;
    }

    return {
      accessToken,
      refreshToken,
      expiresAt,
      email: readOptionalString(parsed.email),
      authPath,
    };
  } catch {
    return undefined;
  }
}

export async function ensureGeminiAccountSession(): Promise<GeminiAccountSession | undefined> {
  ensureGeminiCliSettings();

  const existingSession = getGeminiAccountSession();
  if (existingSession) {
    return existingSession;
  }

  const loginSucceeded = await runGeminiLogin();
  if (!loginSucceeded) {
    return undefined;
  }

  ensureGeminiCliSettings();
  return getGeminiAccountSession();
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

async function runGeminiLogin(): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn(getGeminiExecutable(), [], {
      stdio: 'inherit',
      env: buildGeminiEnvironment(),
      cwd: process.cwd(),
    });

    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
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
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
      const execution = await runGeminiExec(modelId, options);
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
  ensureGeminiCliSettings();

  const warnings = buildGeminiWarnings(options);
  const prompt = flattenPrompt(options.prompt);
  const args = [
    '--model',
    modelId,
    '--sandbox=false',
    '--prompt',
    prompt,
  ];

  return await new Promise((resolve, reject) => {
    const child = spawn(getGeminiExecutable(), args, {
      env: buildGeminiEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(extractCliError(stdout, stderr) || `Gemini CLI failed with exit code ${code}.`));
        return;
      }

      resolve({
        text: stdout.trim(),
        finishReason: 'stop',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
        },
        warnings,
      });
    });
  });
}

function buildGeminiWarnings(options: Pick<LanguageModelV1CallOptions, 'mode'>): LanguageModelV1CallWarning[] {
  if (options.mode.type !== 'regular' || !options.mode.tools || options.mode.tools.length === 0) {
    return [];
  }

  return options.mode.tools.map((tool) => ({
    type: 'unsupported-tool',
    tool,
    details: 'Gemini OAuth currently executes through Gemini CLI and does not expose Yagr tool-calls yet.',
  }));
}

function flattenPrompt(prompt: LanguageModelV1Prompt): string {
  return prompt.map((message) => {
    if (message.role === 'system') {
      return `System:\n${message.content}`;
    }

    if (message.role === 'user') {
      const content = message.content.map((part) => part.type === 'text' ? part.text : `[${part.type}]`).join('\n');
      return `User:\n${content}`;
    }

    if (message.role === 'assistant') {
      const content = message.content.map((part) => {
        if (part.type === 'text' || part.type === 'reasoning') {
          return part.text;
        }
        if (part.type === 'tool-call') {
          return `[tool-call ${part.toolName}] ${JSON.stringify(part.args)}`;
        }
        return `[${part.type}]`;
      }).join('\n');
      return `Assistant:\n${content}`;
    }

    const content = message.content.map((part) => `[tool-result ${part.toolName}] ${JSON.stringify(part.result)}`).join('\n');
    return `Tool:\n${content}`;
  }).join('\n\n');
}

function buildGeminiEnvironment(): NodeJS.ProcessEnv {
  const nextEnv = { ...process.env };
  delete nextEnv.GEMINI_API_KEY;
  delete nextEnv.GOOGLE_API_KEY;
  nextEnv.NO_COLOR = '1';
  nextEnv.CI = '1';
  nextEnv.GEMINI_CLI_NO_RELAUNCH = 'true';
  return nextEnv;
}

function extractCliError(stdout: string, stderr: string): string | undefined {
  const combined = [stdout, stderr].filter(Boolean).join('\n');
  const lines = combined.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1);
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
