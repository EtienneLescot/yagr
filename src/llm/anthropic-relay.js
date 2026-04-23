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
import { translateChatCompletionToResponsesApi, pipeChatCompletionsSseAsResponsesApi, } from './responses-api-relay.js';
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_DEFAULT_MAX_TOKENS = 8096;
// ─── Request translation: OpenAI → Anthropic ────────────────────────────────
function extractStringContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .filter((p) => p.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text)
            .join('\n');
    }
    return '';
}
export function translateChatCompletionsToAnthropic(payload) {
    // Separate system messages from the conversation
    const systemParts = payload.messages
        .filter((m) => m.role === 'system')
        .map((m) => extractStringContent(m.content));
    const system = systemParts.length > 0 ? systemParts.join('\n') : undefined;
    const conversationMessages = payload.messages.filter((m) => m.role !== 'system');
    const anthropicMessages = conversationMessages.map((m) => {
        if (m.role === 'assistant') {
            const blocks = [];
            const text = extractStringContent(m.content);
            if (text) {
                blocks.push({ type: 'text', text });
            }
            if (Array.isArray(m.tool_calls)) {
                for (const tc of m.tool_calls) {
                    let parsedInput = {};
                    try {
                        parsedInput = JSON.parse(tc.function.arguments);
                    }
                    catch {
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
                        type: 'tool_result', // Anthropic's tool_result type
                        tool_use_id: m.tool_call_id,
                        content: extractStringContent(m.content),
                    },
                ],
            };
        }
        // user
        return { role: 'user', content: extractStringContent(m.content) };
    });
    const translated = {
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
            input_schema: t.function.parameters ?? { type: 'object', properties: {} },
        }));
    }
    if (payload.tool_choice !== undefined) {
        // Anthropic tool_choice: { type: 'auto' | 'any' | 'tool', name?: string }
        // OpenAI tool_choice: 'none' | 'auto' | 'required' | { type: 'function', function: { name } }
        if (payload.tool_choice === 'none') {
            // No direct equivalent — omit tools entirely is closest but would break tool availability.
            // Send as auto and let Anthropic decide.
        }
        else if (payload.tool_choice === 'auto') {
            translated.tool_choice = { type: 'auto' };
        }
        else if (payload.tool_choice === 'required') {
            translated.tool_choice = { type: 'any' };
        }
        else if (typeof payload.tool_choice === 'object' &&
            payload.tool_choice !== null &&
            payload.tool_choice.type === 'function') {
            const fn = payload.tool_choice.function;
            translated.tool_choice = { type: 'tool', name: fn.name };
        }
    }
    return translated;
}
// ─── Non-streaming response translation: Anthropic → OpenAI ─────────────────
export function translateAnthropicResponseToChatCompletions(response) {
    const textParts = (response.content ?? []).filter((b) => b.type === 'text');
    const toolUses = (response.content ?? []).filter((b) => b.type === 'tool_use');
    const message = {
        role: 'assistant',
        content: textParts.map((b) => b.text).join('') || null,
    };
    if (toolUses.length > 0) {
        message.tool_calls = toolUses.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
                name: tc.name,
                arguments: JSON.stringify(tc.input),
            },
        }));
    }
    const finishReason = response.stop_reason === 'end_turn'
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
export function translateAnthropicSseEvent(eventType, eventData, state) {
    const completionId = state.completionId;
    const chunk = (delta, finishReason) => {
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
            const msg = eventData.message;
            if (msg?.id) {
                state.completionId = msg.id;
            }
            if (msg?.model) {
                state.model = msg.model;
            }
            // Emit the role delta as the first chunk
            return [chunk({ role: 'assistant', content: '' })];
        }
        case 'content_block_start': {
            const block = eventData.content_block;
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
                                id: block.id,
                                type: 'function',
                                function: { name: block.name, arguments: '' },
                            },
                        ],
                    }),
                ];
            }
            return [];
        }
        case 'content_block_delta': {
            const delta = eventData.delta;
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
            const d = eventData.delta;
            const rawStopReason = d?.stop_reason;
            const finishReason = rawStopReason === 'end_turn'
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
export function createAnthropicSseTranslationState(model) {
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
export async function handleAnthropicRelay(req, res, body, apiKey, options) {
    let payload;
    try {
        payload = JSON.parse(body.toString('utf-8'));
    }
    catch {
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
        const responseJson = (await upstream.json());
        const chatCompletion = translateAnthropicResponseToChatCompletions(responseJson);
        if (options?.fromResponsesApi) {
            const responsesApiBody = translateChatCompletionToResponsesApi(chatCompletion, payload.model);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(responsesApiBody));
        }
        else {
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
    for await (const chunk of upstream.body) {
        buffer += Buffer.from(chunk).toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        let currentEvent = '';
        for (const line of lines) {
            if (line.startsWith('event: ')) {
                currentEvent = line.slice('event: '.length).trim();
            }
            else if (line.startsWith('data: ')) {
                const rawData = line.slice('data: '.length).trim();
                if (rawData === '[DONE]') {
                    break;
                }
                let eventData;
                try {
                    eventData = JSON.parse(rawData);
                }
                catch {
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
async function pipeAnthropicSseAsResponsesApiSse(upstream, res, model) {
    const responseId = `resp_${Date.now()}`;
    const messageId = `msg_${Date.now()}`;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'response.created', response: { id: responseId, object: 'response', model, output: [] } })}\n\n`);
    let text = '';
    let emittedMessageHeader = false;
    const toolItems = new Map();
    let buffer = '';
    let currentEvent = '';
    try {
        for await (const rawChunk of upstream.body) {
            buffer += Buffer.from(rawChunk).toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    currentEvent = line.slice('event: '.length).trim();
                    continue;
                }
                if (!line.startsWith('data: '))
                    continue;
                const raw = line.slice('data: '.length).trim();
                if (!raw || raw === '[DONE]')
                    continue;
                let data;
                try {
                    data = JSON.parse(raw);
                }
                catch {
                    continue;
                }
                switch (currentEvent) {
                    case 'content_block_start': {
                        const block = data.content_block;
                        const blockIndex = typeof data.index === 'number' ? data.index : 0;
                        if (block?.type === 'text') {
                            if (!emittedMessageHeader) {
                                emittedMessageHeader = true;
                                res.write(`data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: messageId, role: 'assistant', content: [], status: 'in_progress' } })}\n\n`);
                                res.write(`data: ${JSON.stringify({ type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } })}\n\n`);
                            }
                        }
                        else if (block?.type === 'tool_use') {
                            const callId = block.id;
                            const outputIdx = (emittedMessageHeader ? 1 : 0) + blockIndex;
                            toolItems.set(blockIndex, { id: callId, name: block.name, args: '' });
                            res.write(`data: ${JSON.stringify({ type: 'response.output_item.added', output_index: outputIdx, item: { type: 'function_call', id: callId, call_id: callId, name: block.name, arguments: '', status: 'in_progress' } })}\n\n`);
                        }
                        break;
                    }
                    case 'content_block_delta': {
                        const delta = data.delta;
                        const blockIndex = typeof data.index === 'number' ? data.index : 0;
                        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
                            text += delta.text;
                            res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: delta.text })}\n\n`);
                        }
                        else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
                            const existing = toolItems.get(blockIndex);
                            if (existing) {
                                existing.args += delta.partial_json;
                                res.write(`data: ${JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: existing.id, call_id: existing.id, delta: delta.partial_json })}\n\n`);
                            }
                        }
                        break;
                    }
                    case 'content_block_stop': {
                        const blockIndex = typeof data.index === 'number' ? data.index : 0;
                        if (blockIndex === 0 && emittedMessageHeader) {
                            res.write(`data: ${JSON.stringify({ type: 'response.output_text.done', output_index: 0, content_index: 0, text })}\n\n`);
                        }
                        else {
                            const tc = toolItems.get(blockIndex);
                            if (tc) {
                                res.write(`data: ${JSON.stringify({ type: 'response.function_call_arguments.done', item_id: tc.id, call_id: tc.id, arguments: tc.args })}\n\n`);
                            }
                        }
                        break;
                    }
                    case 'message_delta': {
                        const d = data.delta;
                        const stopReason = d?.stop_reason;
                        if (emittedMessageHeader) {
                            res.write(`data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: messageId, role: 'assistant', content: [{ type: 'output_text', text }], status: 'completed', stop_reason: stopReason } })}\n\n`);
                        }
                        for (const [idx, tc] of toolItems) {
                            const outputIdx = (emittedMessageHeader ? 1 : 0) + idx;
                            res.write(`data: ${JSON.stringify({ type: 'response.output_item.done', output_index: outputIdx, item: { type: 'function_call', id: tc.id, call_id: tc.id, name: tc.name, arguments: tc.args, status: 'completed' } })}\n\n`);
                        }
                        break;
                    }
                    case 'message_stop': {
                        const responseOutput = [];
                        if (emittedMessageHeader) {
                            responseOutput.push({ type: 'message', id: messageId, role: 'assistant', content: [{ type: 'output_text', text }], status: 'completed' });
                        }
                        for (const tc of toolItems.values()) {
                            responseOutput.push({ type: 'function_call', id: tc.id, call_id: tc.id, name: tc.name, arguments: tc.args, status: 'completed' });
                        }
                        res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { id: responseId, object: 'response', model, output: responseOutput } })}\n\n`);
                        break;
                    }
                }
                currentEvent = '';
            }
        }
    }
    catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
    }
    res.end();
}
// Re-export for use in llm-relay-server when it needs to post-process
// a chat completions response into Responses API format.
export { translateChatCompletionToResponsesApi, pipeChatCompletionsSseAsResponsesApi };
//# sourceMappingURL=anthropic-relay.js.map