import { makeToolStartOperationEvent, makeToolEndOperationEvent, makeThinkingStartEvent, makeThinkingEndEvent, THINKING_OP_ID, } from '../runtime/user-visible-updates.js';
export function createRunAccumulator() {
    return {
        responseText: '',
        requiredActions: [],
        thinkingText: '',
        thinkingStartedAt: 0,
        activeOperations: new Map(),
        fileModificationDetected: false,
        compactions: [],
    };
}
// ---------------------------------------------------------------------------
// Core processor
// ---------------------------------------------------------------------------
/**
 * Process a single `StreamEvent` from `agent.streamEvents()`.
 *
 * Mutates `accumulator` in place and fires the appropriate `callbacks`.
 */
const DEBUG = process.env.DEBUG_LANGGRAPH_EVENTS === '1';
export async function processStreamEvent(event, accumulator, callbacks = {}) {
    if (DEBUG) {
        const eventName = 'name' in event ? event.name : 'unknown';
        const runId = 'run_id' in event ? event.run_id : 'unknown';
        console.error(`[DEBUG_LANGGRAPH_EVENTS] event=${event.event} name=${eventName} run_id=${runId}`);
    }
    switch (event.event) {
        case 'on_chat_model_stream': {
            const { textDelta, thinkingDelta } = extractDeltas(event.data?.chunk);
            if (DEBUG) {
                console.error(`[DEBUG_LANGGRAPH_EVENTS]   textDelta.len=${textDelta.length} thinkingDelta.len=${thinkingDelta.length}`);
                if (textDelta)
                    console.error(`[DEBUG_LANGGRAPH_EVENTS]   textDelta preview: "${textDelta.slice(0, 100)}"`);
            }
            if (thinkingDelta) {
                const isFirst = accumulator.thinkingText.length === 0;
                accumulator.thinkingText += thinkingDelta;
                if (isFirst) {
                    // Emit the opening "thinking" card.
                    const startEvent = makeThinkingStartEvent();
                    accumulator.thinkingStartedAt = startEvent.startedAt;
                    await callbacks.onOperation?.(startEvent);
                }
                else {
                    // Update the card body incrementally.
                    await callbacks.onOperation?.({
                        kind: 'operation',
                        operationId: THINKING_OP_ID,
                        label: 'Thinking…',
                        category: 'thinking',
                        status: 'running',
                        body: accumulator.thinkingText,
                        startedAt: accumulator.thinkingStartedAt,
                    });
                }
                await callbacks.onThinkingDelta?.(thinkingDelta);
            }
            if (textDelta) {
                // Close the thinking card once real text starts flowing.
                if (accumulator.thinkingText.length > 0 && !accumulator.activeOperations.has('thinking:closed')) {
                    const closedSentinel = {
                        kind: 'operation',
                        operationId: THINKING_OP_ID,
                        label: 'Thinking',
                        category: 'thinking',
                        status: 'done',
                        startedAt: accumulator.thinkingStartedAt,
                    };
                    accumulator.activeOperations.set('thinking:closed', closedSentinel);
                    const endPatch = makeThinkingEndEvent(accumulator.thinkingText, accumulator.thinkingStartedAt);
                    await callbacks.onOperation?.({
                        kind: 'operation',
                        operationId: THINKING_OP_ID,
                        label: 'Thinking',
                        category: 'thinking',
                        body: accumulator.thinkingText,
                        startedAt: accumulator.thinkingStartedAt,
                        ...endPatch,
                    });
                }
                accumulator.responseText += textDelta;
                await callbacks.onTextDelta?.(textDelta);
            }
            break;
        }
        case 'on_tool_start': {
            if (DEBUG) {
                console.error(`[DEBUG_LANGGRAPH_EVENTS]   tool_start: ${event.name}`);
            }
            // LangChain packages tool args as: event.data.input = { input: '{"command":"..."}' }
            // i.e. the real args are JSON-stringified under the key "input".
            const rawEventInput = event.data?.input;
            let input;
            const inner = rawEventInput?.input;
            if (typeof inner === 'string') {
                try {
                    input = JSON.parse(inner);
                }
                catch {
                    input = rawEventInput;
                }
            }
            else if (inner != null && typeof inner === 'object') {
                input = inner;
            }
            else {
                input = rawEventInput;
            }
            const toolName = event.name;
            const operationKey = getToolOperationKey(event);
            // Legacy update (still used by surfaces that don't handle operations).
            const update = mapToolStartToUpdate(toolName, input);
            if (update) {
                await callbacks.onUserVisibleUpdate?.(update);
            }
            // New operation card.
            const opEvent = makeToolStartOperationEvent(toolName, input);
            if (opEvent) {
                accumulator.activeOperations.set(operationKey, opEvent);
                await callbacks.onOperation?.(opEvent);
            }
            break;
        }
        case 'on_tool_end': {
            if (DEBUG) {
                const outputPreview = event.data?.output ? String(event.data.output).slice(0, 100) : 'undefined';
                console.error(`[DEBUG_LANGGRAPH_EVENTS]   tool_end: ${event.name} output="${outputPreview}"`);
            }
            const toolName = event.name;
            const operationKey = getToolOperationKey(event);
            const active = accumulator.activeOperations.get(operationKey);
            if (active) {
                const patch = makeToolEndOperationEvent(active.operationId, toolName, event.data?.output, active.startedAt);
                const endEvent = { ...active, ...patch };
                await callbacks.onOperation?.(endEvent);
                accumulator.activeOperations.delete(operationKey);
            }
            await handleToolEnd(toolName, event.data?.output, accumulator, callbacks);
            break;
        }
        case 'on_llm_new_token': {
            const compactionEvent = extractCompactionFromChunk(event.data?.chunk);
            if (compactionEvent) {
                accumulator.compactions.push(compactionEvent);
                await callbacks.onCompaction?.(compactionEvent);
            }
            break;
        }
        case 'on_chain_stream':
        case 'on_chain_end': {
            const compactionEvent = extractCompactionFromChunk(event.data?.chunk);
            if (compactionEvent) {
                accumulator.compactions.push(compactionEvent);
                await callbacks.onCompaction?.(compactionEvent);
            }
            break;
        }
        default:
            break;
    }
}
function getToolOperationKey(event) {
    const toolName = event.name || 'tool';
    const runId = typeof event.run_id === 'string' && event.run_id.length > 0 ? event.run_id : 'unknown';
    return `${toolName}:${runId}`;
}
function extractDeltas(chunk) {
    if (!chunk || typeof chunk !== 'object') {
        return { textDelta: '', thinkingDelta: '' };
    }
    const c = chunk;
    const content = c['content'];
    let text = '';
    let thinking = '';
    if (typeof content === 'string') {
        text = content;
    }
    else if (Array.isArray(content)) {
        for (const part of content) {
            if (typeof part === 'string') {
                text += part;
                continue;
            }
            if (part && typeof part === 'object') {
                const p = part;
                // Anthropic extended thinking: { type: 'thinking', thinking: string }
                if (p['type'] === 'thinking' && typeof p['thinking'] === 'string') {
                    thinking += p['thinking'];
                    continue;
                }
                // Some OpenRouter/Qwen providers: { type: 'reasoning', reasoning_content: string }
                if (p['type'] === 'reasoning' && typeof p['reasoning_content'] === 'string') {
                    thinking += p['reasoning_content'];
                    continue;
                }
                // Standard text part
                if (typeof p['text'] === 'string') {
                    text += p['text'];
                }
            }
        }
    }
    // ChatOpenAI (LangChain) stores DeepSeek-style reasoning_content and our
    // CopilotChatOpenAI subclass maps Gemini's reasoning_text here too.
    const additionalKwargs = c['additional_kwargs'];
    if (typeof additionalKwargs?.reasoning_content === 'string' && additionalKwargs.reasoning_content.length > 0) {
        thinking += additionalKwargs.reasoning_content;
    }
    return { textDelta: text, thinkingDelta: thinking };
}
/** @deprecated Use extractDeltas — kept for callers that only need text. */
function extractTextDelta(chunk) {
    return extractDeltas(chunk).textDelta;
}
// ---------------------------------------------------------------------------
// Compaction event extraction
// ---------------------------------------------------------------------------
function extractCompactionFromChunk(chunk) {
    if (!chunk || typeof chunk !== 'object') {
        return null;
    }
    const c = chunk;
    if (c.type === 'compaction' || c.__type === 'compaction') {
        return {
            summary: String(c.summary ?? 'Context compacted'),
            source: c.source ?? 'llm',
            estimatedTokens: Number(c.estimatedTokens ?? 0),
            thresholdTokens: Number(c.thresholdTokens ?? 0),
            messagesCompacted: Number(c.messagesCompacted ?? 0),
            preservedRecentMessages: Number(c.preservedRecentMessages ?? 4),
            fallbackReason: c.fallbackReason,
        };
    }
    if (c.type === 'context_compaction') {
        return {
            summary: String(c.summary ?? 'Context compacted'),
            source: c.source ?? 'llm',
            estimatedTokens: Number(c.estimatedTokens ?? 0),
            thresholdTokens: Number(c.thresholdTokens ?? 0),
            messagesCompacted: Number(c.messagesCompacted ?? 0),
            preservedRecentMessages: Number(c.preservedRecentMessages ?? 4),
            fallbackReason: c.fallbackReason,
        };
    }
    return null;
}
// ---------------------------------------------------------------------------
// Tool-start → UserVisibleUpdate
// ---------------------------------------------------------------------------
/**
 * Map a tool invocation start to a user-visible progress update.
 * Only a subset of tools produce meaningful banners — everything else is silent.
 */
function mapToolStartToUpdate(toolName, input) {
    switch (toolName) {
        case 'reportProgress':
            // The progress message lives in the tool OUTPUT (on_tool_end), not the
            // input, so we skip here; it is handled in handleToolEnd.
            return undefined;
        case 'requestRequiredAction':
            return {
                tone: 'info',
                title: 'Needs attention',
                detail: typeof input?.title === 'string' ? input.title : undefined,
                dedupeKey: `tool:requestRequiredAction:${input?.title ?? ''}`,
            };
        case 'write_todos':
            return {
                tone: 'info',
                title: 'Plan',
                detail: undefined,
                phase: 'plan',
                dedupeKey: 'tool:write_todos',
            };
        case 'execute':
            return {
                tone: 'info',
                title: 'Shell',
                detail: typeof input?.command === 'string' ? truncate(input.command, 80) : undefined,
                dedupeKey: `tool:execute:${input?.command ?? ''}`,
            };
        case 'httpRequest':
            return {
                tone: 'info',
                title: 'HTTP request',
                detail: typeof input?.url === 'string' ? `${input?.method ?? 'GET'} ${input.url}` : undefined,
                dedupeKey: `tool:httpRequest:${input?.url ?? ''}`,
            };
        default:
            // For generic tool calls show a terse "Tool" banner.
            if (toolName && toolName !== 'ls' && toolName !== 'glob') {
                return {
                    tone: 'info',
                    title: toolName,
                    dedupeKey: `tool:${toolName}`,
                };
            }
            return undefined;
    }
}
// ---------------------------------------------------------------------------
// Tool-end handlers
// ---------------------------------------------------------------------------
async function handleToolEnd(toolName, rawOutput, accumulator, callbacks) {
    const output = parseToolOutput(rawOutput);
    switch (toolName) {
        case 'writeFile':
        case 'write_file':
        case 'writeWorkspaceFile':
        case 'edit_file':
        case 'deleteFile':
        case 'moveFile':
        case 'replaceInFile': {
            accumulator.fileModificationDetected = true;
            break;
        }
        case 'reportProgress': {
            const message = output?.message;
            if (typeof message === 'string') {
                const update = {
                    tone: 'info',
                    title: 'Progress',
                    detail: message,
                    dedupeKey: `tool:reportProgress:${message}`,
                };
                await callbacks.onUserVisibleUpdate?.(update);
            }
            break;
        }
        case 'requestRequiredAction': {
            if (output && isRequiredAction(output)) {
                accumulator.requiredActions.push(output);
            }
            break;
        }
        default:
            break;
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseToolOutput(raw) {
    if (!raw) {
        return undefined;
    }
    if (typeof raw === 'string') {
        const parsed = parseJsonObjectFromText(raw);
        if (!parsed) {
            return undefined;
        }
        const stdout = parsed.stdout;
        if (typeof stdout === 'string') {
            const parsedStdout = parseJsonObjectFromText(stdout);
            if (parsedStdout) {
                return parsedStdout;
            }
        }
        return parsed;
    }
    if (typeof raw === 'object') {
        const obj = raw;
        const kwargs = obj.kwargs;
        if (obj.type === 'constructor' && kwargs && typeof kwargs === 'object') {
            return parseToolOutput(kwargs);
        }
        const content = obj.content;
        if (typeof content === 'string') {
            const parsedContent = parseJsonObjectFromText(content);
            if (parsedContent) {
                return parsedContent;
            }
        }
        const result = obj.result;
        if (typeof result === 'string') {
            const parsedResult = parseJsonObjectFromText(result);
            if (parsedResult) {
                return parsedResult;
            }
        }
        const output = obj.output;
        if (typeof output === 'string') {
            const parsedOutput = parseJsonObjectFromText(output);
            if (parsedOutput) {
                return parsedOutput;
            }
        }
        const stdout = obj.stdout;
        if (typeof stdout === 'string') {
            const parsedStdout = parseJsonObjectFromText(stdout);
            if (parsedStdout) {
                return parsedStdout;
            }
        }
        return obj;
    }
    return undefined;
}
function parseJsonObjectFromText(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        return undefined;
    }
    const exact = tryParseJsonObject(trimmed);
    if (exact) {
        return exact;
    }
    const executePayload = parseExecuteJsonPayload(trimmed);
    if (executePayload) {
        return executePayload;
    }
    const embedded = extractLeadingJsonObject(trimmed);
    if (embedded) {
        return embedded;
    }
    return undefined;
}
function parseExecuteJsonPayload(raw) {
    const exitMatch = raw.match(/\n\[Command (?:succeeded|failed) with exit code \d+\]\s*$/);
    const body = exitMatch ? raw.slice(0, exitMatch.index).trim() : raw;
    return tryParseJsonObject(body) ?? extractLeadingJsonObject(body);
}
function tryParseJsonObject(raw) {
    if (!raw.startsWith('{') || !raw.endsWith('}')) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function extractLeadingJsonObject(raw) {
    if (!raw.startsWith('{')) {
        return undefined;
    }
    let depth = 0;
    let inString = false;
    let escaping = false;
    for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i];
        if (inString) {
            if (escaping) {
                escaping = false;
            }
            else if (ch === '\\') {
                escaping = true;
            }
            else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            depth += 1;
            continue;
        }
        if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return tryParseJsonObject(raw.slice(0, i + 1));
            }
        }
    }
    return undefined;
}
function isRequiredAction(obj) {
    return (typeof obj.id === 'string' &&
        typeof obj.title === 'string' &&
        typeof obj.message === 'string');
}
function truncate(value, maxLen) {
    return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
}
/**
 * Extract the text content from the last AI message in a LangGraph invoke result.
 */
export function extractLastAiMessage(result) {
    const messages = result?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
        return '';
    }
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg && (msg['_getType']?.toString().includes('ai') || msg['role'] === 'assistant')) {
            const content = msg['content'];
            if (typeof content === 'string') {
                return content;
            }
            if (Array.isArray(content)) {
                return content
                    .filter((p) => p?.type === 'text')
                    .map((p) => p.text)
                    .join('');
            }
        }
    }
    return '';
}
//# sourceMappingURL=langgraph-events.js.map