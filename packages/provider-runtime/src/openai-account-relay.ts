/**
 * Translation layer between OpenAI Chat Completions API and the Codex backend
 * (chatgpt.com/backend-api/codex/responses).
 *
 * The Yagr LLM relay receives requests in OpenAI Chat Completions format.
 * When the active provider is openai-oauth, these requests
 * are translated into the Codex Responses API format, forwarded with the required
 * ChatGPT session headers, and the Codex SSE stream is translated back to the
 * OpenAI Chat Completions format. Both streaming and non-streaming modes are supported.
 *
 * Reference:
 *   - Codex backend: chatgpt.com/backend-api/codex/responses
 *   - OpenAI Chat Completions: https://platform.openai.com/docs/api-reference/chat
 */

import http from 'node:http';
import { OPENAI_ACCOUNT_BASE_URL, ensureCodexInstructions, ensureCodexSessionId, ensureOpenAiAccountSession } from './openai-account.js';
import { randomUUID } from 'node:crypto';
import { getYagrPaths } from './config/yagr-home.js';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeFunctionToolParametersSchema } from './tool-schema.js';
import { translateChatCompletionToResponsesApi, pipeChatCompletionsSseAsResponsesApi } from './responses-api-relay.js';
import { CODEX_UPSTREAM_TIMEOUT_MS, withRetry, timeoutSignal } from './utils.js';

const CODEX_RESPONSES_PATH = '/codex/responses';
const JWT_ACCOUNT_CLAIM = 'https://api.openai.com/auth';

// ─── OpenAI request types ─────────────────────────────────────────────────────

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface OpenAIChatCompletionsRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: unknown;
  [key: string]: unknown;
}

function buildRelayCodexUserAgent(): string {
  return 'codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown';
}

function getRelaySessionId(payload: OpenAIChatCompletionsRequest): string {
  const direct = typeof payload.session_id === 'string' ? payload.session_id : undefined;
  const metadata = payload.metadata && typeof payload.metadata === 'object'
    ? payload.metadata as Record<string, unknown>
    : undefined;
  const metaSession = typeof metadata?.session_id === 'string' ? metadata.session_id : undefined;
  const metaLite = typeof metadata?.litellm_session_id === 'string' ? metadata.litellm_session_id : undefined;
  return ensureCodexSessionId(direct || metaSession || metaLite || randomUUID());
}

function getRelayInstallationId(): string {
  const installPath = path.join(getYagrPaths().homeDir, 'installation_id');
  try {
    const existing = fs.readFileSync(installPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // ignore and generate below
  }
  const generated = randomUUID();
  try {
    fs.mkdirSync(path.dirname(installPath), { recursive: true });
    fs.writeFileSync(installPath, generated);
  } catch {
    return generated;
  }
  return generated;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractChatGptAccountId(token: string): string {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT structure');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as Record<string, unknown>;
    const claim = payload[JWT_ACCOUNT_CLAIM] as Record<string, unknown> | undefined;
    const accountId = claim?.chatgpt_account_id;
    if (typeof accountId !== 'string' || !accountId) {
      throw new Error('No chatgpt_account_id in token');
    }
    return accountId;
  } catch {
    throw new Error('Failed to extract chatgpt_account_id from token. Ensure the session was obtained via `codex --login`.');
  }
}

function extractStringContent(content: OpenAIMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('\n');
  }
  return '';
}

// ─── Request translation: OpenAI Chat Completions → Codex ────────────────────

function translateChatCompletionsToCodex(payload: OpenAIChatCompletionsRequest): {
  instructions: string;
  input: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  tool_choice: unknown;
} {
  let instructions = '';
  const input: Array<Record<string, unknown>> = [];

  for (const message of payload.messages) {
    if (message.role === 'system') {
      const text = extractStringContent(message.content);
      instructions = instructions ? `${instructions}\n${text}` : text;
      continue;
    }

    if (message.role === 'user') {
      input.push({
        role: 'user',
        content: [{ type: 'input_text', text: extractStringContent(message.content) }],
      });
      continue;
    }

    if (message.role === 'assistant') {
      const text = extractStringContent(message.content);
      if (text) {
        input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      }
      if (Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
          input.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
      }
      continue;
    }

    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: extractStringContent(message.content),
      });
    }
  }

  const tools =
    Array.isArray(payload.tools) && payload.tools.length > 0
      ? payload.tools.map((t) => ({
          type: 'function',
          name: t.function.name,
          ...(t.function.description ? { description: t.function.description } : {}),
          parameters: normalizeFunctionToolParametersSchema((t.function.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>, { forceRequiredObjectProperties: true }),
          strict: true,
        }))
      : [];

  let tool_choice: unknown = 'auto';
  if (tools.length > 0 && payload.tool_choice !== undefined) {
    if (payload.tool_choice === 'none') {
      tool_choice = 'none';
    } else if (payload.tool_choice === 'required') {
      tool_choice = 'required';
    } else if (typeof payload.tool_choice === 'object' && payload.tool_choice !== null) {
      const fn = (payload.tool_choice as Record<string, unknown>).function as Record<string, unknown> | undefined;
      if (fn?.name) {
        tool_choice = { type: 'function', name: fn.name };
      }
    }
  }

  return {
    instructions: ensureCodexInstructions(instructions),
    input,
    tools,
    tool_choice,
  };
}

// ─── SSE translation state ────────────────────────────────────────────────────

interface CodexSseTranslationState {
  completionId: string;
  model: string;
  createdAt: number;
  text: string;
  toolCalls: Map<string, { id: string; name: string; args: string; index: number }>;
  nextToolIndex: number;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
}

function createCodexSseState(model: string): CodexSseTranslationState {
  return {
    completionId: `chatcmpl-${Date.now()}`,
    model,
    createdAt: Math.floor(Date.now() / 1000),
    text: '',
    toolCalls: new Map(),
    nextToolIndex: 0,
    inputTokens: 0,
    outputTokens: 0,
    finishReason: 'stop',
  };
}

function makeChunk(
  state: CodexSseTranslationState,
  delta: Record<string, unknown>,
  finishReason?: string | null,
): string {
  return `data: ${JSON.stringify({
    id: state.completionId,
    object: 'chat.completion.chunk',
    created: state.createdAt,
    model: state.model,
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
  })}`;
}

/**
 * Translates a single Codex SSE event into zero or more OpenAI SSE data lines.
 * Mutates state to accumulate text, tool calls, and usage.
 */
function translateCodexSseEvent(
  event: Record<string, unknown>,
  state: CodexSseTranslationState,
): string[] {
  const type = typeof event.type === 'string' ? event.type : undefined;
  if (!type) return [];

  if (type === 'response.output_text.delta') {
    const delta = typeof event.delta === 'string' ? event.delta : '';
    state.text += delta;
    return [makeChunk(state, { content: delta })];
  }

  if (type === 'response.output_item.added') {
    const item = (
      typeof event.item === 'object' ? event.item : event.output_item
    ) as Record<string, unknown> | undefined;
    if (!item || item.type !== 'function_call') return [];

    const callId =
      typeof item.call_id === 'string' ? item.call_id :
      typeof item.id === 'string' ? item.id :
      `call_${state.nextToolIndex}`;

    if (!state.toolCalls.has(callId)) {
      const toolIndex = state.nextToolIndex++;
      const name = typeof item.name === 'string' ? item.name : '';
      state.toolCalls.set(callId, { id: callId, name, args: '', index: toolIndex });
      return [makeChunk(state, {
        tool_calls: [{ index: toolIndex, id: callId, type: 'function', function: { name, arguments: '' } }],
      })];
    }
    return [];
  }

  if (type === 'response.output_item.done') {
    const item = (
      typeof event.item === 'object' ? event.item : event.output_item
    ) as Record<string, unknown> | undefined;
    if (!item || item.type !== 'function_call') return [];

    const callId =
      typeof item.call_id === 'string' ? item.call_id :
      typeof item.id === 'string' ? item.id : undefined;

    if (callId && typeof item.arguments === 'string') {
      const existing = state.toolCalls.get(callId);
      if (existing) {
        existing.args = item.arguments;
      }
    }
    return [];
  }

  if (type === 'response.function_call_arguments.delta') {
    const itemId =
      typeof event.item_id === 'string' ? event.item_id :
      typeof event.call_id === 'string' ? event.call_id : undefined;
    const delta = typeof event.delta === 'string' ? event.delta : '';
    if (!itemId || !delta) return [];

    const existing = state.toolCalls.get(itemId);
    if (!existing) return [];
    existing.args += delta;
    return [makeChunk(state, {
      tool_calls: [{ index: existing.index, function: { arguments: delta } }],
    })];
  }

  if (type === 'response.function_call_arguments.done') {
    const itemId =
      typeof event.item_id === 'string' ? event.item_id :
      typeof event.call_id === 'string' ? event.call_id : undefined;
    const finalArgs = typeof event.arguments === 'string' ? event.arguments : undefined;
    if (itemId && finalArgs !== undefined) {
      const existing = state.toolCalls.get(itemId);
      if (existing) existing.args = finalArgs;
    }
    return [];
  }

  if (type === 'response.completed') {
    const resp = event.response as {
      usage?: { input_tokens?: number; output_tokens?: number };
    } | undefined;
    state.inputTokens = resp?.usage?.input_tokens ?? 0;
    state.outputTokens = resp?.usage?.output_tokens ?? 0;
    state.finishReason = state.toolCalls.size > 0 ? 'tool_calls' : 'stop';
    return [
      makeChunk(state, {}, state.finishReason),
      'data: [DONE]',
    ];
  }

  if (type === 'response.failed') {
    const resp = event.response as { error?: { message?: string } } | undefined;
    throw new Error(resp?.error?.message || 'Codex response failed.');
  }

  if (type === 'error') {
    const msg = typeof event.message === 'string' ? event.message : 'Codex stream error.';
    throw new Error(msg);
  }

  return [];
}

// ─── SSE parser ───────────────────────────────────────────────────────────────

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
          try {
            yield JSON.parse(data) as Record<string, unknown>;
          } catch {
            // skip malformed event
          }
        }
      }
      idx = buffer.indexOf('\n\n');
    }
  }
}

// ─── Non-streaming response builder ──────────────────────────────────────────

function buildNonStreamingResponse(state: CodexSseTranslationState): Record<string, unknown> {
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: state.text || null,
  };

  if (state.toolCalls.size > 0) {
    message.tool_calls = [...state.toolCalls.values()].map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.args },
    }));
  }

  return {
    id: state.completionId,
    object: 'chat.completion',
    created: state.createdAt,
    model: state.model,
    choices: [{ index: 0, message, finish_reason: state.finishReason }],
    usage: {
      prompt_tokens: state.inputTokens,
      completion_tokens: state.outputTokens,
      total_tokens: state.inputTokens + state.outputTokens,
    },
  };
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

/**
 * Handles an incoming OpenAI Chat Completions request by translating it to
 * the Codex Responses API, forwarding it with ChatGPT session headers, and
 * streaming/returning the translated response.
 *
 * When `options.fromResponsesApi` is true the response is re-translated into
 * OpenAI Responses API format for upstream compatibility.
 */
export async function handleOpenAiAccountRelay(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer,
  options?: { fromResponsesApi?: boolean },
): Promise<void> {
  const session = await ensureOpenAiAccountSession();
  if (!session) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'OpenAI account session not found. Run `codex --login` to sign in.',
        type: 'server_error',
      },
    }));
    return;
  }

  let payload: OpenAIChatCompletionsRequest;
  try {
    payload = JSON.parse(body.toString('utf-8')) as OpenAIChatCompletionsRequest;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }));
    return;
  }

  let accountId: string;
  try {
    accountId = extractChatGptAccountId(session.accessToken);
  } catch (err) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: String(err), type: 'server_error' } }));
    return;
  }

  const { instructions, input, tools, tool_choice } = translateChatCompletionsToCodex(payload);
  const isStreaming = Boolean(payload.stream);
  const sessionId = getRelaySessionId(payload);
  const windowId = `${sessionId}:0`;
  const installationId = getRelayInstallationId();

  const codexBody = {
    model: payload.model,
    store: false,
    stream: true, // Codex always streams — we accumulate for non-streaming callers
    instructions,
    input,
    include: ['reasoning.encrypted_content'],
    client_metadata: {
      'x-codex-installation-id': installationId,
      'x-codex-window-id': windowId,
    },
    ...(tools.length > 0 ? { tools, tool_choice, parallel_tool_calls: true } : { tool_choice: 'auto' }),
  };

  // Abort the upstream request when the client disconnects.
  const clientDisconnectController = new AbortController();
  _req.on('close', () => clientDisconnectController.abort());

  const upstream = await withRetry(async () => {
    const response = await fetch(`${OPENAI_ACCOUNT_BASE_URL}${CODEX_RESPONSES_PATH}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'chatgpt-account-id': accountId,
        'OpenAI-Beta': 'responses=experimental',
        'originator': 'codex_cli_rs',
        'User-Agent': buildRelayCodexUserAgent(),
        'x-client-request-id': sessionId,
        'x-codex-window-id': windowId,
        'x-codex-installation-id': installationId,
        'accept': 'text/event-stream',
        'content-type': 'application/json',
        'session_id': sessionId,
      },
      body: JSON.stringify(codexBody),
      signal: AbortSignal.any([
        clientDisconnectController.signal,
        timeoutSignal(CODEX_UPSTREAM_TIMEOUT_MS, 'openai-account-relay'),
      ]),
    });

    if (!response.ok || !response.body) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(errorBody || `Codex upstream error: HTTP ${response.status}`);
    }

    return response;
  }, 'openai-account-relay upstream');

  const state = createCodexSseState(payload.model);

  if (isStreaming) {
    if (options?.fromResponsesApi) {
      // Accumulate Codex SSE → build chat completions SSE in memory → pipe as Responses API SSE.
      // We generate a synthetic Response-like object from the accumulated state.
      try {
        for await (const event of parseCodexSSE(upstream.body as ReadableStream<Uint8Array>)) {
          translateCodexSseEvent(event, state);
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: String(err), type: 'server_error' } }));
        return;
      }
      const chatCompletion = buildNonStreamingResponse(state);
      const responsesApiBody = translateChatCompletionToResponsesApi(chatCompletion, payload.model);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responsesApiBody));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      for await (const event of parseCodexSSE(upstream.body as ReadableStream<Uint8Array>)) {
        const lines = translateCodexSseEvent(event, state);
        for (const line of lines) {
          res.write(`${line}\n\n`);
        }
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: { message: String(err), type: 'server_error' } })}\n\n`);
    }

    res.end();
    return;
  }

  // Non-streaming: accumulate the full Codex SSE response, then return OpenAI JSON
  try {
    for await (const event of parseCodexSSE(upstream.body as ReadableStream<Uint8Array>)) {
      translateCodexSseEvent(event, state);
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: String(err), type: 'server_error' } }));
    return;
  }

  const chatCompletion = buildNonStreamingResponse(state);
  if (options?.fromResponsesApi) {
    const responsesApiBody = translateChatCompletionToResponsesApi(chatCompletion, payload.model);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responsesApiBody));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(chatCompletion));
}
