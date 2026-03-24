import fs from 'node:fs';
import path from 'node:path';
import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1CallWarning,
  LanguageModelV1FunctionTool,
  LanguageModelV1FunctionToolCall,
  LanguageModelV1Prompt,
  LanguageModelV1StreamPart,
  LanguageModelV1ToolChoice,
} from '@ai-sdk/provider';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
import {
  filterFunctionToolsForCapability,
  normalizeToolChoiceForCapability,
  type YagrModelCapabilityProfile,
} from './model-capabilities.js';
import { getCachedProviderModelMetadata, primeProviderModelMetadata } from './provider-metadata.js';
import { normalizeFunctionToolParametersSchema } from './tool-schema.js';

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

export function createGitHubCopilotLanguageModel(
  modelId: string,
  capabilityProfile?: YagrModelCapabilityProfile,
): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'copilot-proxy.github',
    modelId,
    defaultObjectGenerationMode: undefined,
    supportsImageUrls: false,
    supportsStructuredOutputs: Boolean(capabilityProfile?.supportsStructuredOutputs),
    async doGenerate(options) {
      const execution = await runGitHubCopilotCompletion(modelId, options, capabilityProfile);
      return {
        text: execution.text,
        finishReason: execution.finishReason,
        usage: execution.usage,
        ...(execution.toolCalls ? { toolCalls: execution.toolCalls } : {}),
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
      const execution = await runGitHubCopilotCompletion(modelId, options, capabilityProfile);
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
  capabilityProfile?: YagrModelCapabilityProfile,
): Promise<{
  text: string;
  finishReason: 'stop' | 'error' | 'tool-calls' | 'length' | 'content-filter' | 'other' | 'unknown';
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  toolCalls?: LanguageModelV1FunctionToolCall[];
  warnings: LanguageModelV1CallWarning[];
}> {
  const session = await ensureGitHubCopilotSession();
  if (!session) {
    throw new Error('GitHub Copilot OAuth session not found. Run `yagr setup` again.');
  }

  const runtimeAuth = await resolveCopilotApiToken(session.githubToken);
  const regularMode = options.mode.type === 'regular' ? options.mode : undefined;
  const tools = getFunctionTools(options.mode, capabilityProfile);
  const warnings = buildCopilotWarnings(options, tools);
  const endpoint = await resolveCopilotEndpoint(modelId, runtimeAuth.token, runtimeAuth.baseUrl);
  const execution = endpoint === '/responses'
    ? await runCopilotResponsesCompletion(modelId, options.prompt, tools, regularMode?.toolChoice, capabilityProfile, runtimeAuth)
    : await runCopilotChatCompletions(modelId, options.prompt, tools, regularMode?.toolChoice, capabilityProfile, runtimeAuth);
  return {
    ...execution,
    warnings,
  };
}

async function resolveCopilotEndpoint(modelId: string, token: string, baseUrl: string): Promise<'/chat/completions' | '/responses'> {
  const cached = getCachedProviderModelMetadata('copilot-proxy', modelId);
  const cachedEndpoints = cached?.supportedEndpoints ?? [];
  if (cachedEndpoints.includes('/responses') && !cachedEndpoints.includes('/chat/completions')) {
    return '/responses';
  }

  await primeProviderModelMetadata('copilot-proxy', modelId, token, baseUrl).catch(() => undefined);
  const metadata = getCachedProviderModelMetadata('copilot-proxy', modelId);
  const supportedEndpoints = metadata?.supportedEndpoints ?? [];
  if (supportedEndpoints.includes('/responses') && !supportedEndpoints.includes('/chat/completions')) {
    return '/responses';
  }

  return '/chat/completions';
}

async function runCopilotChatCompletions(
  modelId: string,
  prompt: LanguageModelV1Prompt,
  tools: LanguageModelV1FunctionTool[],
  toolChoice: LanguageModelV1ToolChoice | undefined,
  capabilityProfile: YagrModelCapabilityProfile | undefined,
  runtimeAuth: { token: string; baseUrl: string },
): Promise<{
  text: string;
  finishReason: 'stop' | 'error' | 'tool-calls' | 'length' | 'content-filter' | 'other' | 'unknown';
  usage: { promptTokens: number; completionTokens: number };
  toolCalls?: LanguageModelV1FunctionToolCall[];
}> {
  const response = await fetch(`${runtimeAuth.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildCopilotHeaders(runtimeAuth.token),
    body: JSON.stringify({
      model: modelId,
      messages: toOpenAiMessages(prompt),
      ...(tools.length > 0 ? { tools: toOpenAiTools(tools), tool_choice: toOpenAiToolChoice(toolChoice, capabilityProfile) } : {}),
      stream: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body.trim() || `GitHub Copilot chat completion failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const toolCalls = extractOpenAiToolCalls(payload);
  const finishReason = normalizeChatCompletionsFinishReason(payload, toolCalls);
  return {
    text: extractChatCompletionsText(payload),
    finishReason,
    usage: extractChatCompletionsUsage(payload),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

async function runCopilotResponsesCompletion(
  modelId: string,
  prompt: LanguageModelV1Prompt,
  tools: LanguageModelV1FunctionTool[],
  toolChoice: LanguageModelV1ToolChoice | undefined,
  capabilityProfile: YagrModelCapabilityProfile | undefined,
  runtimeAuth: { token: string; baseUrl: string },
): Promise<{
  text: string;
  finishReason: 'stop' | 'error' | 'tool-calls' | 'length' | 'content-filter' | 'other' | 'unknown';
  usage: { promptTokens: number; completionTokens: number };
  toolCalls?: LanguageModelV1FunctionToolCall[];
}> {
  const { instructions, input } = convertPromptToResponsesInput(prompt);
  const response = await fetch(`${runtimeAuth.baseUrl}/responses`, {
    method: 'POST',
    headers: buildCopilotHeaders(runtimeAuth.token),
    body: JSON.stringify({
      model: modelId,
      ...(instructions ? { instructions } : {}),
      input,
      ...(tools.length > 0 ? { tools: toResponsesTools(tools), tool_choice: toResponsesToolChoice(toolChoice, capabilityProfile) } : {}),
      stream: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body.trim() || `GitHub Copilot responses completion failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const toolCalls = extractResponsesToolCalls(payload);
  const finishReason = normalizeResponsesFinishReason(payload, toolCalls);
  return {
    text: extractResponsesText(payload),
    finishReason,
    usage: extractResponsesUsage(payload),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function buildCopilotHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': COPILOT_USER_AGENT,
    'Editor-Version': COPILOT_EDITOR_VERSION,
    'Editor-Plugin-Version': COPILOT_EDITOR_PLUGIN_VERSION,
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

function buildCopilotWarnings(
  options: Pick<LanguageModelV1CallOptions, 'mode'>,
  functionTools: LanguageModelV1FunctionTool[],
): LanguageModelV1CallWarning[] {
  if (options.mode.type !== 'regular' || !options.mode.tools || options.mode.tools.length === 0) {
    return [];
  }

  const warnings: LanguageModelV1CallWarning[] = [];
  for (const tool of options.mode.tools) {
    if (tool.type === 'provider-defined') {
      warnings.push({
        type: 'unsupported-tool',
        tool,
        details: 'GitHub Copilot OAuth only supports function tools in OpenAI-compatible format.',
      });
    }
  }

  if (functionTools.length > 0) {
    return warnings;
  }

  return options.mode.tools.map((tool) => ({
    type: 'unsupported-tool',
    tool,
    details: 'GitHub Copilot OAuth did not receive any function tools for this call.',
  }));
}

function getFunctionTools(
  mode: Pick<LanguageModelV1CallOptions, 'mode'>['mode'],
  capabilityProfile?: YagrModelCapabilityProfile,
): LanguageModelV1FunctionTool[] {
  if (mode.type !== 'regular' || !Array.isArray(mode.tools) || mode.tools.length === 0) {
    return [];
  }

  const tools = mode.tools.filter((tool): tool is LanguageModelV1FunctionTool => tool.type === 'function');
  return capabilityProfile ? filterFunctionToolsForCapability(tools, capabilityProfile) : tools;
}

function toOpenAiTools(tools: LanguageModelV1FunctionTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: normalizeFunctionToolParametersSchema(tool.parameters, {
        forceRequiredObjectProperties: false,
      }),
    },
  }));
}

function toOpenAiToolChoice(
  toolChoice: LanguageModelV1ToolChoice | undefined,
  capabilityProfile?: YagrModelCapabilityProfile,
): unknown {
  const normalizedToolChoice = capabilityProfile
    ? normalizeToolChoiceForCapability(toolChoice, capabilityProfile)
    : toolChoice;

  if (!normalizedToolChoice || normalizedToolChoice.type === 'auto') {
    return 'auto';
  }
  if (normalizedToolChoice.type === 'none' || normalizedToolChoice.type === 'required') {
    return normalizedToolChoice.type;
  }
  if (normalizedToolChoice.type === 'tool') {
    return {
      type: 'function',
      function: {
        name: normalizedToolChoice.toolName,
      },
    };
  }
  return 'auto';
}

function toOpenAiMessages(prompt: LanguageModelV1Prompt): Array<Record<string, unknown>> {
  return prompt.map((message) => {
    if (message.role === 'system') {
      return { role: 'system', content: message.content };
    }

    if (message.role === 'user') {
      return {
        role: 'user',
        content: message.content.map((part) => part.type === 'text' ? part.text : `[${part.type}]`).join('\n'),
      };
    }

    if (message.role === 'assistant') {
      const textContent = message.content
        .filter((part) => part.type === 'text' || part.type === 'reasoning')
        .map((part) => part.text)
        .join('\n')
        .trim();

      const toolCalls = message.content
        .filter((part) => part.type === 'tool-call')
        .map((part) => ({
          id: part.toolCallId,
          type: 'function',
          function: {
            name: part.toolName,
            arguments: JSON.stringify(part.args ?? {}),
          },
        }));

      return {
        role: 'assistant',
        content: textContent.length > 0 ? textContent : '',
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
    }

    return message.content.map((part) => ({
      role: 'tool',
      tool_call_id: part.toolCallId,
      name: part.toolName,
      content: stringifyToolResult(part.result),
    }));
  }).flat();
}

function convertPromptToResponsesInput(prompt: LanguageModelV1Prompt): {
  instructions: string | undefined;
  input: Array<Record<string, unknown>>;
} {
  let instructions: string | undefined;
  const input: Array<Record<string, unknown>> = [];

  for (const message of prompt) {
    if (message.role === 'system') {
      instructions = message.content;
      continue;
    }
    if (message.role === 'user') {
      const text = message.content.map((p) => p.type === 'text' ? p.text : `[${p.type}]`).join('\n');
      input.push({ role: 'user', content: [{ type: 'input_text', text }] });
    } else if (message.role === 'assistant') {
      const text = message.content
        .filter((p) => p.type === 'text' || p.type === 'reasoning')
        .map((p) => p.text)
        .join('\n')
        .trim();
      if (text) {
        input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      }

      for (const part of message.content) {
        if (part.type !== 'tool-call') {
          continue;
        }
        input.push({
          type: 'function_call',
          call_id: part.toolCallId,
          name: part.toolName,
          arguments: JSON.stringify(part.args ?? {}),
        });
      }
    } else {
      for (const part of message.content) {
        input.push({
          type: 'function_call_output',
          call_id: part.toolCallId,
          output: stringifyToolResult(part.result),
        });
      }
    }
  }

  return { instructions, input };
}

function toResponsesTools(tools: LanguageModelV1FunctionTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: normalizeFunctionToolParametersSchema(tool.parameters, {
      forceRequiredObjectProperties: true,
    }),
    strict: true,
  }));
}

function toResponsesToolChoice(
  toolChoice: LanguageModelV1ToolChoice | undefined,
  capabilityProfile?: YagrModelCapabilityProfile,
): unknown {
  const normalizedToolChoice = capabilityProfile
    ? normalizeToolChoiceForCapability(toolChoice, capabilityProfile)
    : toolChoice;

  if (!normalizedToolChoice || normalizedToolChoice.type === 'auto') {
    return 'auto';
  }
  if (normalizedToolChoice.type === 'none' || normalizedToolChoice.type === 'required') {
    return normalizedToolChoice.type;
  }
  if (normalizedToolChoice.type === 'tool') {
    return {
      type: 'function',
      name: normalizedToolChoice.toolName,
    };
  }
  return 'auto';
}

function extractChatCompletionsText(payload: Record<string, unknown>): string {
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

function extractResponsesText(payload: Record<string, unknown>): string {
  const outputText = readOptionalString(payload.output_text);
  if (outputText) {
    return outputText;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    if (record.type === 'message' && Array.isArray(record.content)) {
      return record.content.flatMap((part) => {
        if (!part || typeof part !== 'object') {
          return [];
        }
        const partRecord = part as Record<string, unknown>;
        return typeof partRecord.text === 'string' ? [partRecord.text] : [];
      });
    }

    return [];
  }).join('');
}

function extractChatCompletionsUsage(payload: Record<string, unknown>): { promptTokens: number; completionTokens: number } {
  const usage = payload.usage as Record<string, unknown> | undefined;
  return {
    promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
    completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0,
  };
}

function extractResponsesUsage(payload: Record<string, unknown>): { promptTokens: number; completionTokens: number } {
  const usage = payload.usage as Record<string, unknown> | undefined;
  return {
    promptTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0,
    completionTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0,
  };
}

function extractOpenAiToolCalls(payload: Record<string, unknown>): LanguageModelV1FunctionToolCall[] {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return [];
  }

  const message = (choices[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
  const rawToolCalls = message?.tool_calls;
  if (!Array.isArray(rawToolCalls)) {
    return [];
  }

  return rawToolCalls
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return undefined;
      }
      const call = entry as Record<string, unknown>;
      const id = readOptionalString(call.id) || `copilot-tool-call-${index + 1}`;
      const fn = call.function as Record<string, unknown> | undefined;
      const toolName = readOptionalString(fn?.name);
      if (!toolName) {
        return undefined;
      }
      const argsRaw = fn?.arguments;
      const args = typeof argsRaw === 'string' ? argsRaw : JSON.stringify(argsRaw ?? {});
      return {
        toolCallType: 'function' as const,
        toolCallId: id,
        toolName,
        args,
      };
    })
    .filter((entry): entry is LanguageModelV1FunctionToolCall => Boolean(entry));
}

function extractResponsesToolCalls(payload: Record<string, unknown>): LanguageModelV1FunctionToolCall[] {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return undefined;
      }

      const call = entry as Record<string, unknown>;
      if (call.type !== 'function_call') {
        return undefined;
      }

      const id = readOptionalString(call.call_id) || readOptionalString(call.id) || `copilot-responses-tool-call-${index + 1}`;
      const toolName = readOptionalString(call.name);
      const args = readOptionalString(call.arguments);
      if (!toolName || !args) {
        return undefined;
      }

      return {
        toolCallType: 'function' as const,
        toolCallId: id,
        toolName,
        args,
      };
    })
    .filter((entry): entry is LanguageModelV1FunctionToolCall => Boolean(entry));
}

function normalizeChatCompletionsFinishReason(
  payload: Record<string, unknown>,
  toolCalls: LanguageModelV1FunctionToolCall[],
): 'stop' | 'error' | 'tool-calls' | 'length' | 'content-filter' | 'other' | 'unknown' {
  if (toolCalls.length > 0) {
    return 'tool-calls';
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return 'unknown';
  }
  const raw = readOptionalString((choices[0] as Record<string, unknown>)?.finish_reason);
  if (!raw) {
    return 'unknown';
  }
  if (raw === 'stop' || raw === 'length' || raw === 'content-filter' || raw === 'tool-calls' || raw === 'error' || raw === 'other' || raw === 'unknown') {
    return raw;
  }
  if (raw === 'tool_calls') {
    return 'tool-calls';
  }
  if (raw === 'content_filter') {
    return 'content-filter';
  }
  return 'other';
}

function normalizeResponsesFinishReason(
  payload: Record<string, unknown>,
  toolCalls: LanguageModelV1FunctionToolCall[],
): 'stop' | 'error' | 'tool-calls' | 'length' | 'content-filter' | 'other' | 'unknown' {
  if (toolCalls.length > 0) {
    return 'tool-calls';
  }

  const raw = readOptionalString(payload.status);
  if (!raw) {
    return 'unknown';
  }
  if (raw === 'completed') {
    return 'stop';
  }
  if (raw === 'incomplete') {
    return 'length';
  }
  if (raw === 'failed') {
    return 'error';
  }
  return 'other';
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
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
