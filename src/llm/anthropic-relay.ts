/**
 * Translation layer between OpenAI Chat Completions API and Anthropic Messages API.
 *
 * The Yagr LLM relay receives requests in OpenAI Chat Completions format from n8n
 * (via lmChatOpenAi nodes). When the active provider is anthropic-proxy, these
 * requests are translated into Anthropic Messages API format, forwarded, and the
 * responses are translated back. Both streaming (SSE) and non-streaming modes are
 * supported, as well as tool calls.
 *
 * Reference:
 *   - Anthropic Messages API: https://docs.anthropic.com/en/api/messages
 *   - OpenAI Chat Completions: https://platform.openai.com/docs/api-reference/chat
 */

import http from 'node:http';

import {
  translateChatCompletionToResponsesApi,
  pipeChatCompletionsSseAsResponsesApi,
} from './responses-api-relay.js';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_DEFAULT_MAX_TOKENS = 8096;

// ─── OpenAI request types ────────────────────────────────────────────────────

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
    strict?: boolean;
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

// ─── Anthropic request/response types ───────────────────────────────────────

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: unknown;
}

interface AnthropicNonStreamResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

// ─── Request translation: OpenAI → Anthropic ────────────────────────────────

function extractStringContent(content: OpenAIMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('\n');
  }
  return '';
}

export function translateChatCompletionsToAnthropic(
  payload: OpenAIChatCompletionsRequest,
): AnthropicRequest {
  // Separate system messages from the conversation
  const systemParts = payload.messages
    .filter((m) => m.role === 'system')
    .map((m) => extractStringContent(m.content));
  const system = systemParts.length > 0 ? systemParts.join('\n') : undefined;

  const conversationMessages = payload.messages.filter((m) => m.role !== 'system');

  const anthropicMessages: AnthropicMessage[] = conversationMessages.map((m) => {
    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      const text = extractStringContent(m.content);
      if (text) {
        blocks.push({ type: 'text', text });
      }
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          let parsedInput: unknown = {};
          try {
            parsedInput = JSON.parse(tc.function.arguments);
          } catch {
            parsedInput = tc.function.arguments;
          }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: parsedInput,
          });
        }
      }
      return { role: 'assistant', content: blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks };
    }

    if (m.role === 'tool') {
      // Tool results in Anthropic must be wrapped in a user message
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result' as unknown as 'text', // Anthropic's tool_result type
            tool_use_id: m.tool_call_id,
            content: extractStringContent(m.content),
          } as unknown as AnthropicTextBlock,
        ],
      };
    }

    // user
    return { role: 'user', content: extractStringContent(m.content) };
  });

  const translated: AnthropicRequest = {
    model: payload.model,
    messages: anthropicMessages,
    max_tokens: payload.max_tokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    stream: payload.stream ?? false,
  };

  if (system) {
    translated.system = system;
  }

  if (payload.temperature !== undefined) {
    translated.temperature = payload.temperature;
  }

  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    translated.tools = payload.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: (t.function.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
    }));
  }

  if (payload.tool_choice !== undefined) {
    // Anthropic tool_choice: { type: 'auto' | 'any' | 'tool', name?: string }
    // OpenAI tool_choice: 'none' | 'auto' | 'required' | { type: 'function', function: { name } }
    if (payload.tool_choice === 'none') {
      // No direct equivalent — omit tools entirely is closest but would break tool availability.
      // Send as auto and let Anthropic decide.
    } else if (payload.tool_choice === 'auto') {
      translated.tool_choice = { type: 'auto' };
    } else if (payload.tool_choice === 'required') {
      translated.tool_choice = { type: 'any' };
    } else if (
      typeof payload.tool_choice === 'object' &&
      payload.tool_choice !== null &&
      (payload.tool_choice as Record<string, unknown>).type === 'function'
    ) {
      const fn = (payload.tool_choice as Record<string, unknown>).function as Record<string, unknown>;
      translated.tool_choice = { type: 'tool', name: fn.name };
    }
  }

  return translated;
}

// ─── Non-streaming response translation: Anthropic → OpenAI ─────────────────

export function translateAnthropicResponseToChatCompletions(
  response: AnthropicNonStreamResponse,
): Record<string, unknown> {
  const textParts = (response.content ?? []).filter((b): b is AnthropicTextBlock => b.type === 'text');
  const toolUses = (response.content ?? []).filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use');

  const message: Record<string, unknown> = {
    role: 'assistant',
    content: textParts.map((b) => b.text).join('') || null,
  };

  if (toolUses.length > 0) {
    message.tool_calls = toolUses.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.input),
      },
    }));
  }

  const finishReason =
    response.stop_reason === 'end_turn'
      ? 'stop'
      : response.stop_reason === 'tool_use'
        ? 'tool_calls'
        : response.stop_reason === 'max_tokens'
          ? 'length'
          : 'stop';

  return {
    id: response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: response.usage?.input_tokens ?? 0,
      completion_tokens: response.usage?.output_tokens ?? 0,
      total_tokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    },
  };
}

// ─── SSE streaming translation: Anthropic events → OpenAI chunks ─────────────

/**
 * Translates a single Anthropic SSE event into zero or more OpenAI SSE data lines.
 * Returns an array of `data: {...}` strings (without trailing newline) to write.
 * State is mutated across calls to track tool_call index and accumulated tool input.
 */
export function translateAnthropicSseEvent(
  eventType: string,
  eventData: Record<string, unknown>,
  state: AnthropicSseTranslationState,
): string[] {
  const completionId = state.completionId;

  const chunk = (delta: Record<string, unknown>, finishReason?: string | null): string => {
    const payload = {
      id: completionId,
      object: 'chat.completion.chunk',
      created: state.createdAt,
      model: state.model,
      choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
    };
    return `data: ${JSON.stringify(payload)}`;
  };

  switch (eventType) {
    case 'message_start': {
      const msg = eventData.message as Record<string, unknown> | undefined;
      if (msg?.id) {
        state.completionId = msg.id as string;
      }
      if (msg?.model) {
        state.model = msg.model as string;
      }
      // Emit the role delta as the first chunk
      return [chunk({ role: 'assistant', content: '' })];
    }

    case 'content_block_start': {
      const block = eventData.content_block as Record<string, unknown> | undefined;
      if (!block) {
        return [];
      }
      if (block.type === 'tool_use') {
        const toolIndex = state.nextToolIndex++;
        state.currentToolIndex = toolIndex;
        state.toolInputAccumulator[toolIndex] = '';
        return [
          chunk({
            tool_calls: [
              {
                index: toolIndex,
                id: block.id as string,
                type: 'function',
                function: { name: block.name as string, arguments: '' },
              },
            ],
          }),
        ];
      }
      return [];
    }

    case 'content_block_delta': {
      const delta = eventData.delta as Record<string, unknown> | undefined;
      if (!delta) {
        return [];
      }
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        return [chunk({ content: delta.text })];
      }
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const toolIndex = state.currentToolIndex ?? 0;
        state.toolInputAccumulator[toolIndex] = (state.toolInputAccumulator[toolIndex] ?? '') + delta.partial_json;
        return [
          chunk({
            tool_calls: [{ index: toolIndex, function: { arguments: delta.partial_json } }],
          }),
        ];
      }
      return [];
    }

    case 'message_delta': {
      const d = eventData.delta as Record<string, unknown> | undefined;
      const rawStopReason = d?.stop_reason as string | undefined;
      const finishReason =
        rawStopReason === 'end_turn'
          ? 'stop'
          : rawStopReason === 'tool_use'
            ? 'tool_calls'
            : rawStopReason === 'max_tokens'
              ? 'length'
              : 'stop';
      return [chunk({}, finishReason)];
    }

    case 'message_stop':
      return ['data: [DONE]'];

    default:
      return [];
  }
}

export interface AnthropicSseTranslationState {
  completionId: string;
  model: string;
  createdAt: number;
  nextToolIndex: number;
  currentToolIndex: number | undefined;
  toolInputAccumulator: Record<number, string>;
}

export function createAnthropicSseTranslationState(model: string): AnthropicSseTranslationState {
  return {
    completionId: `chatcmpl-${Date.now()}`,
    model,
    createdAt: Math.floor(Date.now() / 1000),
    nextToolIndex: 0,
    currentToolIndex: undefined,
    toolInputAccumulator: {},
  };
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

/**
 * Handles an incoming OpenAI Chat Completions request by translating it to
 * the Anthropic Messages API, forwarding it, and streaming/returning the
 * translated response.
 *
 * When `options.fromResponsesApi` is true the response is re-translated into
 * OpenAI Responses API format so n8n receives the format it expects.
 */
export async function handleAnthropicRelay(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer,
  apiKey: string,
  options?: { fromResponsesApi?: boolean },
): Promise<void> {
  let payload: OpenAIChatCompletionsRequest;
  try {
    payload = JSON.parse(body.toString('utf-8')) as OpenAIChatCompletionsRequest;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }));
    return;
  }

  const anthropicPayload = translateChatCompletionsToAnthropic(payload);
  const isStreaming = anthropicPayload.stream === true;

  const upstream = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      ...(isStreaming ? { Accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify(anthropicPayload),
  });

  if (!upstream.ok || !upstream.body) {
    const errorBody = await upstream.text().catch(() => '');
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(errorBody);
    return;
  }

  if (!isStreaming) {
    const responseJson = (await upstream.json()) as AnthropicNonStreamResponse;
    const chatCompletion = translateAnthropicResponseToChatCompletions(responseJson);
    if (options?.fromResponsesApi) {
      const responsesApiBody = translateChatCompletionToResponsesApi(chatCompletion, payload.model);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responsesApiBody));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(chatCompletion));
    }
    return;
  }

  if (options?.fromResponsesApi) {
    // Translate Anthropic SSE → chat completions SSE intermediately,
    // then re-emit as Responses API SSE by proxying through a transform.
    // We build the chat completions SSE in memory and pipe via our utility.
    await pipeAnthropicSseAsResponsesApiSse(upstream, res, payload.model);
    return;
  }

  // Default streaming: translate Anthropic SSE → OpenAI chat completions SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const state = createAnthropicSseTranslationState(payload.model);
  let buffer = '';

  for await (const chunk of upstream.body as AsyncIterable<Uint8Array>) {
    buffer += Buffer.from(chunk).toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice('event: '.length).trim();
      } else if (line.startsWith('data: ')) {
        const rawData = line.slice('data: '.length).trim();
        if (rawData === '[DONE]') {
          break;
        }
        let eventData: Record<string, unknown>;
        try {
          eventData = JSON.parse(rawData) as Record<string, unknown>;
        } catch {
          continue;
        }
        const outLines = translateAnthropicSseEvent(currentEvent, eventData, state);
        for (const outLine of outLines) {
          res.write(`${outLine}\n\n`);
        }
        currentEvent = '';
      }
    }
  }

  res.end();
}

/**
 * Translates an Anthropic SSE stream directly into OpenAI Responses API SSE
 * events, bypassing the intermediate chat completions format.
 */
async function pipeAnthropicSseAsResponsesApiSse(
  upstream: Response,
  res: http.ServerResponse,
  model: string,
): Promise<void> {
  const responseId = `resp_${Date.now()}`;
  const messageId = `msg_${Date.now()}`;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(
    `data: ${JSON.stringify({ type: 'response.created', response: { id: responseId, object: 'response', model, output: [] } })}\n\n`,
  );

  let text = '';
  let emittedMessageHeader = false;
  const toolItems = new Map<number, { id: string; name: string; args: string }>();
  let buffer = '';
  let currentEvent = '';

  try {
    for await (const rawChunk of upstream.body as AsyncIterable<Uint8Array>) {
      buffer += Buffer.from(rawChunk).toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice('event: '.length).trim();
          continue;
        }
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice('data: '.length).trim();
        if (!raw || raw === '[DONE]') continue;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }

        switch (currentEvent) {
          case 'content_block_start': {
            const block = data.content_block as Record<string, unknown> | undefined;
            const blockIndex = typeof data.index === 'number' ? data.index : 0;
            if (block?.type === 'text') {
              if (!emittedMessageHeader) {
                emittedMessageHeader = true;
                res.write(
                  `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: messageId, role: 'assistant', content: [], status: 'in_progress' } })}\n\n`,
                );
                res.write(
                  `data: ${JSON.stringify({ type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } })}\n\n`,
                );
              }
            } else if (block?.type === 'tool_use') {
              const callId = block.id as string;
              const outputIdx = (emittedMessageHeader ? 1 : 0) + blockIndex;
              toolItems.set(blockIndex, { id: callId, name: block.name as string, args: '' });
              res.write(
                `data: ${JSON.stringify({ type: 'response.output_item.added', output_index: outputIdx, item: { type: 'function_call', id: callId, call_id: callId, name: block.name, arguments: '', status: 'in_progress' } })}\n\n`,
              );
            }
            break;
          }

          case 'content_block_delta': {
            const delta = data.delta as Record<string, unknown> | undefined;
            const blockIndex = typeof data.index === 'number' ? data.index : 0;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              text += delta.text;
              res.write(
                `data: ${JSON.stringify({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: delta.text })}\n\n`,
              );
            } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              const existing = toolItems.get(blockIndex);
              if (existing) {
                existing.args += delta.partial_json as string;
                res.write(
                  `data: ${JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: existing.id, call_id: existing.id, delta: delta.partial_json })}\n\n`,
                );
              }
            }
            break;
          }

          case 'content_block_stop': {
            const blockIndex = typeof data.index === 'number' ? data.index : 0;
            if (blockIndex === 0 && emittedMessageHeader) {
              res.write(
                `data: ${JSON.stringify({ type: 'response.output_text.done', output_index: 0, content_index: 0, text })}\n\n`,
              );
            } else {
              const tc = toolItems.get(blockIndex);
              if (tc) {
                res.write(
                  `data: ${JSON.stringify({ type: 'response.function_call_arguments.done', item_id: tc.id, call_id: tc.id, arguments: tc.args })}\n\n`,
                );
              }
            }
            break;
          }

          case 'message_delta': {
            const d = data.delta as Record<string, unknown> | undefined;
            const stopReason = d?.stop_reason as string | undefined;
            if (emittedMessageHeader) {
              res.write(
                `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: messageId, role: 'assistant', content: [{ type: 'output_text', text }], status: 'completed', stop_reason: stopReason } })}\n\n`,
              );
            }
            for (const [idx, tc] of toolItems) {
              const outputIdx = (emittedMessageHeader ? 1 : 0) + idx;
              res.write(
                `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: outputIdx, item: { type: 'function_call', id: tc.id, call_id: tc.id, name: tc.name, arguments: tc.args, status: 'completed' } })}\n\n`,
              );
            }
            break;
          }

          case 'message_stop': {
            const responseOutput: Array<Record<string, unknown>> = [];
            if (emittedMessageHeader) {
              responseOutput.push({ type: 'message', id: messageId, role: 'assistant', content: [{ type: 'output_text', text }], status: 'completed' });
            }
            for (const tc of toolItems.values()) {
              responseOutput.push({ type: 'function_call', id: tc.id, call_id: tc.id, name: tc.name, arguments: tc.args, status: 'completed' });
            }
            res.write(
              `data: ${JSON.stringify({ type: 'response.completed', response: { id: responseId, object: 'response', model, output: responseOutput } })}\n\n`,
            );
            break;
          }
        }

        currentEvent = '';
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
  }

  res.end();
}

// Re-export for use in llm-relay-server when it needs to post-process
// a chat completions response into Responses API format.
export { translateChatCompletionToResponsesApi, pipeChatCompletionsSseAsResponsesApi };
