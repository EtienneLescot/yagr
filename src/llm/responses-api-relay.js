/**
 * Utilities for translating between OpenAI Chat Completions format and
 * OpenAI Responses API format, used when the relay proxies a provider that
 * does not natively support the /v1/responses endpoint.
 *
 * Used by:
 *   - The transparent proxy path for providers like Google/Gemini
 *   - The Anthropic relay handler (anthropic, anthropic-proxy)
 *   - The OpenAI account relay handler (openai-oauth / Codex)
 */
// ─── Non-streaming: Chat Completions → Responses API ─────────────────────────
export function translateChatCompletionToResponsesApi(chatCompletion, model) {
    const choices = chatCompletion.choices;
    const choice = choices?.[0];
    const message = choice?.message;
    const content = typeof message?.content === 'string' ? message.content : '';
    const toolCalls = message?.tool_calls;
    const usage = chatCompletion.usage;
    const output = [];
    if (content) {
        output.push({
            type: 'message',
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: [{ type: 'output_text', text: content }],
            status: 'completed',
        });
    }
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        for (const tc of toolCalls) {
            const fn = tc.function;
            output.push({
                type: 'function_call',
                id: tc.id,
                call_id: tc.id,
                name: fn?.name,
                arguments: fn?.arguments ?? '',
                status: 'completed',
            });
        }
    }
    if (output.length === 0) {
        output.push({
            type: 'message',
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
            status: 'completed',
        });
    }
    const baseId = typeof chatCompletion.id === 'string' ? chatCompletion.id : '';
    const responseId = baseId.startsWith('chatcmpl-')
        ? baseId.replace('chatcmpl-', 'resp_')
        : `resp_${Date.now()}`;
    return {
        id: responseId,
        object: 'response',
        created_at: chatCompletion.created ?? Math.floor(Date.now() / 1000),
        model: chatCompletion.model ?? model,
        output,
        ...(usage
            ? {
                usage: {
                    input_tokens: usage.prompt_tokens ?? 0,
                    output_tokens: usage.completion_tokens ?? 0,
                    total_tokens: usage.total_tokens ?? 0,
                },
            }
            : {}),
    };
}
// ─── Streaming: Chat Completions SSE → Responses API SSE ─────────────────────
/**
 * Reads an upstream chat completions SSE stream and writes the equivalent
 * Responses API SSE events directly to the HTTP response.
 */
export async function pipeChatCompletionsSseAsResponsesApi(upstream, res, model) {
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
    const toolCalls = new Map();
    let buffer = '';
    try {
        for await (const rawChunk of upstream.body) {
            buffer += Buffer.from(rawChunk).toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                const raw = line.slice(6).trim();
                if (raw === '[DONE]')
                    continue;
                let data;
                try {
                    data = JSON.parse(raw);
                }
                catch {
                    continue;
                }
                const choice = data.choices?.[0];
                if (!choice)
                    continue;
                const delta = choice.delta;
                if (!delta)
                    continue;
                // Emit message item header on first content delta
                if ((delta.role === 'assistant' || typeof delta.content === 'string') && !emittedMessageHeader) {
                    emittedMessageHeader = true;
                    res.write(`data: ${JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: messageId, role: 'assistant', content: [], status: 'in_progress' } })}\n\n`);
                    res.write(`data: ${JSON.stringify({ type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } })}\n\n`);
                }
                if (typeof delta.content === 'string' && delta.content) {
                    text += delta.content;
                    res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: delta.content })}\n\n`);
                }
                // Tool call deltas
                const tcDeltas = delta.tool_calls;
                if (Array.isArray(tcDeltas)) {
                    for (const tc of tcDeltas) {
                        const idx = typeof tc.index === 'number' ? tc.index : 0;
                        const fn = tc.function;
                        if (typeof tc.id === 'string' && tc.id) {
                            const callId = tc.id;
                            const outputIdx = (emittedMessageHeader ? 1 : 0) + idx;
                            toolCalls.set(idx, { id: callId, name: String(fn?.name ?? ''), args: '' });
                            res.write(`data: ${JSON.stringify({ type: 'response.output_item.added', output_index: outputIdx, item: { type: 'function_call', id: callId, call_id: callId, name: fn?.name, arguments: '', status: 'in_progress' } })}\n\n`);
                        }
                        if (typeof fn?.arguments === 'string' && fn.arguments) {
                            const existing = toolCalls.get(idx);
                            if (existing) {
                                existing.args += fn.arguments;
                                res.write(`data: ${JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: existing.id, call_id: existing.id, delta: fn.arguments })}\n\n`);
                            }
                        }
                    }
                }
                const finishReason = choice.finish_reason;
                if (finishReason && typeof finishReason === 'string') {
                    if (emittedMessageHeader) {
                        res.write(`data: ${JSON.stringify({ type: 'response.output_text.done', output_index: 0, content_index: 0, text })}\n\n`);
                        res.write(`data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: messageId, role: 'assistant', content: [{ type: 'output_text', text }], status: 'completed' } })}\n\n`);
                    }
                    for (const [tcIdx, tc] of toolCalls) {
                        const outputIdx = (emittedMessageHeader ? 1 : 0) + tcIdx;
                        res.write(`data: ${JSON.stringify({ type: 'response.function_call_arguments.done', item_id: tc.id, call_id: tc.id, arguments: tc.args })}\n\n`);
                        res.write(`data: ${JSON.stringify({ type: 'response.output_item.done', output_index: outputIdx, item: { type: 'function_call', id: tc.id, call_id: tc.id, name: tc.name, arguments: tc.args, status: 'completed' } })}\n\n`);
                    }
                    const responseOutput = [];
                    if (emittedMessageHeader) {
                        responseOutput.push({
                            type: 'message',
                            id: messageId,
                            role: 'assistant',
                            content: [{ type: 'output_text', text }],
                            status: 'completed',
                        });
                    }
                    for (const tc of toolCalls.values()) {
                        responseOutput.push({
                            type: 'function_call',
                            id: tc.id,
                            call_id: tc.id,
                            name: tc.name,
                            arguments: tc.args,
                            status: 'completed',
                        });
                    }
                    res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { id: responseId, object: 'response', model, output: responseOutput } })}\n\n`);
                }
            }
        }
    }
    catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
    }
    res.end();
}
//# sourceMappingURL=responses-api-relay.js.map