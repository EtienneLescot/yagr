/**
 * LangGraph event adapter.
 *
 * Translates the `StreamEvent` objects emitted by `agent.streamEvents()`
 * into the Yagr gateway contracts used by WebUI, Telegram, and TUI:
 *
 *   - Text delta accumulation
 *   - `YagrUserVisibleUpdate` for progress / phase events
 *   - `YagrRequiredAction` collection from `requestRequiredAction` tool output
 *   - `write_todos` (deepagents planning tool) mapped to a plan-phase update
 *   - `YagrOperationEvent` for per-tool and thinking operation cards
 *   - `YagrContextCompactionEvent` for context compaction events
 */
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { ImpactLedger } from '@yagr/impact-ledger';
import { recordRuntimeOperationImpact, type RuntimeImpactContext } from '@yagr/reality-observer';
import type { RuntimeOperationEvent } from '@yagr/runtime-events';
import type { YagrContextCompactionEvent, YagrContextUsageEvent, YagrOperationEvent, YagrRequiredAction, YagrToolEvent } from '../types.js';
import {
  type YagrUserVisibleUpdate,
  makeToolStartOperationEvent,
  makeToolEndOperationEvent,
  makeThinkingStartEvent,
  makeThinkingEndEvent,
  THINKING_OP_ID,
} from '../runtime/user-visible-updates.js';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface LangGraphRunAccumulator {
  /** Concatenated response text built from `on_chat_model_stream` deltas. */
  responseText: string;
  /** Required actions raised via `requestRequiredAction` tool calls. */
  requiredActions: YagrRequiredAction[];
  /** Accumulated thinking text across the current turn. */
  thinkingText: string;
  /** When the current thinking block started (ms). */
  thinkingStartedAt: number;
  /** Map of event-scoped tool run keys → operation metadata for in-flight tool calls. */
  activeOperations: Map<string, YagrOperationEvent>;
  /** Set to true when a file-modifying tool completes successfully. */
  fileModificationDetected: boolean;
  /** Compaction events that occurred during this run. */
  compactions: YagrContextCompactionEvent[];
  /** Real context-usage events reported by the provider/runtime. */
  contextUsages: YagrContextUsageEvent[];
  /** Dedupe keys for usage metadata that appears in both stream and end events. */
  emittedUsageKeys: Set<string>;
}

export interface LangGraphEventCallbacks {
  onTextDelta?: (delta: string) => void | Promise<void>;
  /** Called with each reasoning/thinking text delta from the LLM. */
  onThinkingDelta?: (delta: string) => void | Promise<void>;
  onUserVisibleUpdate?: (update: YagrUserVisibleUpdate) => void | Promise<void>;
  /**
   * Called when an operation card is created or updated.
   * Callers patch by `operationId` — a second call for the same id is an update.
   */
  onOperation?: (event: YagrOperationEvent) => void | Promise<void>;
  impact?: {
    ledger: ImpactLedger;
    context: RuntimeImpactContext;
  };
  /** Called when a context compaction event occurs. */
  onCompaction?: (event: YagrContextCompactionEvent) => void | Promise<void>;
  /** Called when provider/runtime context usage metadata is available. */
  onContextUsage?: (event: YagrContextUsageEvent) => void | Promise<void>;
  /** Context-window size for the active model, required for fillPercent. */
  contextWindowTokens?: number;
}

export function createRunAccumulator(): LangGraphRunAccumulator {
  return {
    responseText: '',
    requiredActions: [],
    thinkingText: '',
    thinkingStartedAt: 0,
    activeOperations: new Map(),
    fileModificationDetected: false,
    compactions: [],
    contextUsages: [],
    emittedUsageKeys: new Set(),
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

export async function processStreamEvent(
  event: StreamEvent,
  accumulator: LangGraphRunAccumulator,
  callbacks: LangGraphEventCallbacks = {},
): Promise<void> {
  if (DEBUG) {
    const eventName = 'name' in event ? (event.name as string) : 'unknown';
    const runId = 'run_id' in event ? (event.run_id as string) : 'unknown';
    console.error(`[DEBUG_LANGGRAPH_EVENTS] event=${event.event} name=${eventName} run_id=${runId}`);
  }

  switch (event.event) {
    case 'on_chat_model_stream': {
      const { textDelta, thinkingDelta } = extractDeltas(event.data?.chunk);
      await emitContextUsage(event, event.data?.chunk, accumulator, callbacks);

      if (DEBUG) {
        console.error(`[DEBUG_LANGGRAPH_EVENTS]   textDelta.len=${textDelta.length} thinkingDelta.len=${thinkingDelta.length}`);
        if (textDelta) console.error(`[DEBUG_LANGGRAPH_EVENTS]   textDelta preview: "${textDelta.slice(0, 100)}"`);
      }

      if (thinkingDelta) {
        const isFirst = accumulator.thinkingText.length === 0;
        accumulator.thinkingText += thinkingDelta;

        if (isFirst) {
          // Emit the opening "thinking" card.
          const startEvent = makeThinkingStartEvent();
          accumulator.thinkingStartedAt = startEvent.startedAt;
          await emitOperation(callbacks, startEvent);
        } else {
          // Update the card body incrementally.
          await emitOperation(callbacks, {
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
          const closedSentinel: YagrOperationEvent = {
            kind: 'operation',
            operationId: THINKING_OP_ID,
            label: 'Thinking',
            category: 'thinking',
            status: 'done',
            startedAt: accumulator.thinkingStartedAt,
          };
          accumulator.activeOperations.set('thinking:closed', closedSentinel);
          const endPatch = makeThinkingEndEvent(accumulator.thinkingText, accumulator.thinkingStartedAt);
          await emitOperation(callbacks, {
            kind: 'operation',
            operationId: THINKING_OP_ID,
            label: 'Thinking',
            category: 'thinking',
            body: accumulator.thinkingText,
            startedAt: accumulator.thinkingStartedAt,
            ...endPatch,
          } as YagrOperationEvent);
        }

        accumulator.responseText += textDelta;
        await callbacks.onTextDelta?.(textDelta);
      }
      break;
    }

    case 'on_chat_model_end': {
      await emitContextUsage(event, event.data, accumulator, callbacks);
      await emitContextUsage(event, event.data?.output, accumulator, callbacks);
      break;
    }

    case 'on_tool_start': {
      if (DEBUG) {
        console.error(`[DEBUG_LANGGRAPH_EVENTS]   tool_start: ${event.name}`);
      }
      // LangChain packages tool args as: event.data.input = { input: '{"command":"..."}' }
      // i.e. the real args are JSON-stringified under the key "input".
      const rawEventInput = event.data?.input as Record<string, unknown> | undefined;
      let input: Record<string, unknown> | undefined;
      const inner = rawEventInput?.input;
      if (typeof inner === 'string') {
        try { input = JSON.parse(inner) as Record<string, unknown>; } catch { input = rawEventInput; }
      } else if (inner != null && typeof inner === 'object') {
        input = inner as Record<string, unknown>;
      } else {
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
        await emitOperation(callbacks, opEvent);
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
        const endEvent: YagrOperationEvent = { ...active, ...patch };
        await emitOperation(callbacks, endEvent);
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

async function emitContextUsage(
  event: StreamEvent,
  payload: unknown,
  accumulator: LangGraphRunAccumulator,
  callbacks: LangGraphEventCallbacks,
): Promise<void> {
  const usage = extractContextUsageFromPayload(payload, callbacks.contextWindowTokens);
  if (!usage) {
    return;
  }
  const runId = typeof event.run_id === 'string' ? event.run_id : 'unknown';
  const key = `${runId}:${usage.promptTokens}:${usage.completionTokens}`;
  if (accumulator.emittedUsageKeys.has(key)) {
    return;
  }
  accumulator.emittedUsageKeys.add(key);
  accumulator.contextUsages.push(usage);
  await callbacks.onContextUsage?.(usage);
}

function extractContextUsageFromPayload(payload: unknown, contextWindowTokens?: number): YagrContextUsageEvent | null {
  if (!contextWindowTokens || contextWindowTokens <= 0) {
    return null;
  }
  const tokenUsage = extractTokenUsageMetadata(payload);
  if (!tokenUsage) {
    return null;
  }
  const totalTokens = tokenUsage.promptTokens + tokenUsage.completionTokens;
  return {
    type: 'context-usage',
    promptTokens: tokenUsage.promptTokens,
    completionTokens: tokenUsage.completionTokens,
    contextWindowTokens,
    fillPercent: Math.max(0, Math.min(100, Math.round((totalTokens / contextWindowTokens) * 100))),
    source: 'api',
  };
}

function extractTokenUsageMetadata(payload: unknown): { promptTokens: number; completionTokens: number } | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const obj = payload as Record<string, unknown>;
  const direct = normalizeTokenUsage(obj);
  if (direct) {
    return direct;
  }
  const knownContainers = [
    obj.usage_metadata,
    obj.usage,
    obj.tokenUsage,
    obj.token_usage,
    obj.llmOutput,
    obj.response_metadata,
    obj.output,
    obj.message,
  ];
  for (const value of knownContainers) {
    const usage = extractTokenUsageMetadata(value);
    if (usage) {
      return usage;
    }
  }
  if (Array.isArray(obj.generations)) {
    for (const generationGroup of obj.generations) {
      if (!Array.isArray(generationGroup)) {
        continue;
      }
      for (const generation of generationGroup) {
        const usage = extractTokenUsageMetadata(generation);
        if (usage) {
          return usage;
        }
      }
    }
  }
  return null;
}

function normalizeTokenUsage(obj: Record<string, unknown>): { promptTokens: number; completionTokens: number } | null {
  const promptTokens = firstNumber(obj.promptTokens, obj.inputTokens, obj.prompt_tokens, obj.input_tokens);
  const completionTokens = firstNumber(obj.completionTokens, obj.outputTokens, obj.completion_tokens, obj.output_tokens);
  return promptTokens !== undefined && completionTokens !== undefined
    ? { promptTokens, completionTokens }
    : null;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

async function emitOperation(callbacks: LangGraphEventCallbacks, event: YagrOperationEvent): Promise<void> {
  await callbacks.onOperation?.(event);
  if (!callbacks.impact) {
    return;
  }
  try {
    recordRuntimeOperationImpact(callbacks.impact.ledger, callbacks.impact.context, event as RuntimeOperationEvent);
  } catch (err) {
    console.error('[impact-ledger] Failed to record runtime operation impact:', err);
  }
}

function getToolOperationKey(event: StreamEvent): string {
  const toolName = event.name || 'tool';
  const runId = typeof event.run_id === 'string' && event.run_id.length > 0 ? event.run_id : 'unknown';
  return `${toolName}:${runId}`;
}

// ---------------------------------------------------------------------------
// Delta extraction (text + thinking)
// ---------------------------------------------------------------------------

interface ExtractedDeltas {
  textDelta: string;
  thinkingDelta: string;
}

function extractDeltas(chunk: unknown): ExtractedDeltas {
  if (!chunk || typeof chunk !== 'object') {
    return { textDelta: '', thinkingDelta: '' };
  }

  const c = chunk as Record<string, unknown>;
  const content = c['content'];

  let text = '';
  let thinking = '';

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        text += part;
        continue;
      }
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>;
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
  const additionalKwargs = c['additional_kwargs'] as Record<string, unknown> | undefined;
  if (typeof additionalKwargs?.reasoning_content === 'string' && additionalKwargs.reasoning_content.length > 0) {
    thinking += additionalKwargs.reasoning_content;
  }

  return { textDelta: text, thinkingDelta: thinking };
}

/** @deprecated Use extractDeltas — kept for callers that only need text. */
function extractTextDelta(chunk: unknown): string {
  return extractDeltas(chunk).textDelta;
}

// ---------------------------------------------------------------------------
// Compaction event extraction
// ---------------------------------------------------------------------------

function extractCompactionFromChunk(chunk: unknown): YagrContextCompactionEvent | null {
  if (!chunk || typeof chunk !== 'object') {
    return null;
  }

  const c = chunk as Record<string, unknown>;

  if (c.type === 'compaction' || c.__type === 'compaction') {
    return {
      summary: String(c.summary ?? 'Context compacted'),
      source: (c.source as 'llm' | 'fallback') ?? 'llm',
      estimatedTokens: Number(c.estimatedTokens ?? 0),
      thresholdTokens: Number(c.thresholdTokens ?? 0),
      messagesCompacted: Number(c.messagesCompacted ?? 0),
      preservedRecentMessages: Number(c.preservedRecentMessages ?? 4),
      fallbackReason: c.fallbackReason as string | undefined,
    };
  }

  if (c.type === 'context_compaction') {
    return {
      summary: String(c.summary ?? 'Context compacted'),
      source: (c.source as 'llm' | 'fallback') ?? 'llm',
      estimatedTokens: Number(c.estimatedTokens ?? 0),
      thresholdTokens: Number(c.thresholdTokens ?? 0),
      messagesCompacted: Number(c.messagesCompacted ?? 0),
      preservedRecentMessages: Number(c.preservedRecentMessages ?? 4),
      fallbackReason: c.fallbackReason as string | undefined,
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
function mapToolStartToUpdate(
  toolName: string,
  input: Record<string, unknown> | undefined,
): YagrUserVisibleUpdate | undefined {
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

async function handleToolEnd(
  toolName: string,
  rawOutput: unknown,
  accumulator: LangGraphRunAccumulator,
  callbacks: LangGraphEventCallbacks,
): Promise<void> {
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
        const update: YagrUserVisibleUpdate = {
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
        accumulator.requiredActions.push(output as unknown as YagrRequiredAction);
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

function parseToolOutput(raw: unknown): Record<string, unknown> | undefined {
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
    const obj = raw as Record<string, unknown>;
    const kwargs = obj.kwargs;
    if (obj.type === 'constructor' && kwargs && typeof kwargs === 'object') {
      return parseToolOutput(kwargs as Record<string, unknown>);
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

function parseJsonObjectFromText(raw: string): Record<string, unknown> | undefined {
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

function parseExecuteJsonPayload(raw: string): Record<string, unknown> | undefined {
  const exitMatch = raw.match(/\n\[Command (?:succeeded|failed) with exit code \d+\]\s*$/);
  const body = exitMatch ? raw.slice(0, exitMatch.index).trim() : raw;
  return tryParseJsonObject(body) ?? extractLeadingJsonObject(body);
}

function tryParseJsonObject(raw: string): Record<string, unknown> | undefined {
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function extractLeadingJsonObject(raw: string): Record<string, unknown> | undefined {
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
      } else if (ch === '\\') {
        escaping = true;
      } else if (ch === '"') {
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

function isRequiredAction(obj: Record<string, unknown>): boolean {
  return (
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.message === 'string'
  );
}

function truncate(value: string, maxLen: number): string {
  return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
}

/**
 * Extract the text content from the last AI message in a LangGraph invoke result.
 */
export function extractLastAiMessage(result: Record<string, unknown>): string {
  const messages = result?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg && (msg['_getType']?.toString().includes('ai') || msg['role'] === 'assistant')) {
      const content = msg['content'];
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .filter((p): p is { type: string; text: string } => p?.type === 'text')
          .map((p) => p.text)
          .join('');
      }
    }
  }

  return '';
}
