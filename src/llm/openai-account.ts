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

const CODEX_EXECUTABLE = ['npx', '-y', '@openai/codex@latest'] as const;

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
    const child = spawn(CODEX_EXECUTABLE[0], [...CODEX_EXECUTABLE.slice(1), 'login'], {
      stdio: 'inherit',
      env: buildCodexEnvironment(),
    });

    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

export function createOpenAiAccountLanguageModel(modelId: string): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'openai-proxy.codex',
    modelId,
    defaultObjectGenerationMode: undefined,
    supportsImageUrls: false,
    supportsStructuredOutputs: false,
    async doGenerate(options) {
      const execution = await runCodexExec(modelId, options);
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
          id: execution.threadId,
          timestamp: new Date(),
          modelId,
        },
      };
    },
    async doStream(options) {
      const execution = await runCodexExec(modelId, options);
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

export async function validateOpenAiAccountRuntime(modelId = OPENAI_ACCOUNT_DEFAULT_MODEL): Promise<{
  ok: boolean;
  text?: string;
  error?: string;
}> {
  if (process.env.YAGR_SKIP_CODEX_RUNTIME_VALIDATION === '1') {
    return { ok: true, text: 'OK' };
  }

  try {
    const result = await runCodexExec(modelId, {
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

async function runCodexExec(
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
  threadId?: string;
}> {
  const warnings = buildCodexWarnings(options);
  const prompt = flattenPrompt(options.prompt);
  const args = [
    ...CODEX_EXECUTABLE.slice(1),
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-m',
    modelId,
    '--',
    prompt,
  ];

  return await new Promise((resolve, reject) => {
    const child = spawn(CODEX_EXECUTABLE[0], args, {
      env: buildCodexEnvironment(),
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
        reject(new Error(extractCodexError(stdout, stderr) || `Codex exec failed with exit code ${code}.`));
        return;
      }

      const parsed = parseCodexExecJson(stdout);
      resolve({
        text: parsed.text,
        finishReason: 'stop',
        usage: parsed.usage,
        warnings,
        threadId: parsed.threadId,
      });
    });
  });
}

function buildCodexWarnings(options: Pick<LanguageModelV1CallOptions, 'mode'>): LanguageModelV1CallWarning[] {
  if (options.mode.type !== 'regular' || !options.mode.tools || options.mode.tools.length === 0) {
    return [];
  }

  return options.mode.tools.map((tool) => ({
    type: 'unsupported-tool',
    tool,
    details: 'openai-proxy currently executes via Codex account runtime and does not expose Yagr tool-calls yet.',
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

function parseCodexExecJson(stdout: string): {
  text: string;
  usage: { promptTokens: number; completionTokens: number };
  threadId?: string;
} {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'));

  let threadId: string | undefined;
  let text = '';
  let promptTokens = 0;
  let completionTokens = 0;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        threadId = event.thread_id;
      }
      if (event.type === 'item.completed') {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === 'agent_message' && typeof item.text === 'string') {
          text = item.text;
        }
      }
      if (event.type === 'turn.completed') {
        const usage = event.usage as Record<string, unknown> | undefined;
        promptTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : promptTokens;
        completionTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : completionTokens;
      }
    } catch {
      // Ignore non-JSON or partial lines.
    }
  }

  return {
    text,
    usage: {
      promptTokens,
      completionTokens,
    },
    threadId,
  };
}

function extractCodexError(stdout: string, stderr: string): string | undefined {
  const combined = [stdout, stderr].filter(Boolean).join('\n');
  const lines = combined.split('\n').map((line) => line.trim()).filter(Boolean);
  const explicitError = lines.find((line) => /error[:\s]/i.test(line));
  return explicitError || lines.at(-1);
}

function buildCodexEnvironment(): NodeJS.ProcessEnv {
  const nextEnv = { ...process.env };
  delete nextEnv.OPENAI_API_KEY;
  delete nextEnv.LM_STUDIO_API_BASE;
  return nextEnv;
}
