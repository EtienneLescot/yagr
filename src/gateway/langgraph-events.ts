/**
 * LangGraph event adapter.
 *
 * Translates the `StreamEvent` objects emitted by `agent.streamEvents()`
 * into the Yagr gateway contracts used by WebUI, Telegram, and TUI:
 *
 *   - Text delta accumulation
 *   - `YagrUserVisibleUpdate` for progress / phase events
 *   - `YagrRequiredAction` collection from `requestRequiredAction` tool output
 *   - Workflow embed extraction from `presentWorkflowResult` tool output
 *   - `write_todos` (deepagents planning tool) mapped to a plan-phase update
 *   - `YagrOperationEvent` for per-tool and thinking operation cards
 */
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { YagrOperationEvent, YagrRequiredAction, YagrToolEvent } from '../types.js';
import {
  type YagrUserVisibleUpdate,
  makeToolStartOperationEvent,
  makeToolEndOperationEvent,
  makeThinkingStartEvent,
  makeThinkingEndEvent,
  THINKING_OP_ID,
} from '../runtime/user-visible-updates.js';
import { WORKFLOW_EMBED_TYPE } from '../manager-tooling/present-workflow.js';
import type { WorkflowEmbedPayload } from '../manager-tooling/present-workflow.js';
import { enrichWorkflowEmbed } from './n8n-workflow-middleware.js';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface LangGraphRunAccumulator {
  /** Concatenated response text built from `on_chat_model_stream` deltas. */
  responseText: string;
  /** Required actions raised via `requestRequiredAction` tool calls. */
  requiredActions: YagrRequiredAction[];
  /** Workflow embeds raised via `presentWorkflowResult` tool calls. */
  workflowEmbeds: WorkflowEmbedPayload[];
  /** Accumulated thinking text across the current turn. */
  thinkingText: string;
  /** When the current thinking block started (ms). */
  thinkingStartedAt: number;
  /** Map of event-scoped tool run keys → operation metadata for in-flight tool calls. */
  activeOperations: Map<string, YagrOperationEvent>;
}

export interface LangGraphEventCallbacks {
  onTextDelta?: (delta: string) => void | Promise<void>;
  /** Called with each reasoning/thinking text delta from the LLM. */
  onThinkingDelta?: (delta: string) => void | Promise<void>;
  onUserVisibleUpdate?: (update: YagrUserVisibleUpdate) => void | Promise<void>;
  onWorkflowEmbed?: (embed: WorkflowEmbedPayload) => void | Promise<void>;
  /**
   * Called when an operation card is created or updated.
   * Callers patch by `operationId` — a second call for the same id is an update.
   */
  onOperation?: (event: YagrOperationEvent) => void | Promise<void>;
}

export function createRunAccumulator(): LangGraphRunAccumulator {
  return {
    responseText: '',
    requiredActions: [],
    workflowEmbeds: [],
    thinkingText: '',
    thinkingStartedAt: 0,
    activeOperations: new Map(),
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
export async function processStreamEvent(
  event: StreamEvent,
  accumulator: LangGraphRunAccumulator,
  callbacks: LangGraphEventCallbacks = {},
): Promise<void> {
  switch (event.event) {
    case 'on_chat_model_stream': {
      const { textDelta, thinkingDelta } = extractDeltas(event.data?.chunk);

      if (thinkingDelta) {
        const isFirst = accumulator.thinkingText.length === 0;
        accumulator.thinkingText += thinkingDelta;

        if (isFirst) {
          // Emit the opening "thinking" card.
          const startEvent = makeThinkingStartEvent();
          accumulator.thinkingStartedAt = startEvent.startedAt;
          await callbacks.onOperation?.(startEvent);
        } else {
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
          await callbacks.onOperation?.({
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

    case 'on_tool_start': {
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
        await callbacks.onOperation?.(opEvent);
      }
      break;
    }

    case 'on_tool_end': {
      const toolName = event.name;
      const operationKey = getToolOperationKey(event);
      const active = accumulator.activeOperations.get(operationKey);
      if (active) {
        const patch = makeToolEndOperationEvent(active.operationId, toolName, event.data?.output, active.startedAt);
        const endEvent: YagrOperationEvent = { ...active, ...patch };
        await callbacks.onOperation?.(endEvent);
        accumulator.activeOperations.delete(operationKey);
      }

      await handleToolEnd(toolName, event.data?.output, accumulator, callbacks);
      break;
    }

    default:
      break;
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

    case 'yagrProxy':
      return {
        tone: 'info',
        title: 'Configuring LLM relay',
        dedupeKey: 'tool:yagrProxy',
      };

    case 'httpRequest':
      return {
        tone: 'info',
        title: 'HTTP request',
        detail: typeof input?.url === 'string' ? `${input?.method ?? 'GET'} ${input.url}` : undefined,
        dedupeKey: `tool:httpRequest:${input?.url ?? ''}`,
      };

    default:
      // For generic tool calls (n8nac, etc.) show a terse "Tool" banner.
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
    case 'execute': {
      if (output?.__type === WORKFLOW_EMBED_TYPE) {
        const embed = output as unknown as WorkflowEmbedPayload;
        const enriched = enrichWorkflowEmbedPayload(embed);
        accumulator.workflowEmbeds.push(enriched);
        await callbacks.onWorkflowEmbed?.(enriched);
      }
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

    case 'presentWorkflowResult': {
      if (output?.__type === WORKFLOW_EMBED_TYPE) {
        const embed = output as unknown as WorkflowEmbedPayload;
        const enriched = enrichWorkflowEmbedPayload(embed);
        accumulator.workflowEmbeds.push(enriched);
        await callbacks.onWorkflowEmbed?.(enriched);
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
    const executePayload = parseExecuteJsonPayload(raw);
    if (executePayload) {
      return executePayload;
    }

    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }

  if (typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }

  return undefined;
}

function parseExecuteJsonPayload(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const exitMatch = trimmed.match(/\n\[Command (?:succeeded|failed) with exit code \d+\]\s*$/);
  const body = exitMatch ? trimmed.slice(0, exitMatch.index).trim() : trimmed;
  if (!body.startsWith('{') || !body.endsWith('}')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function isRequiredAction(obj: Record<string, unknown>): boolean {
  return (
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.message === 'string'
  );
}

/**
 * Pass the embed payload through the n8n workflow middleware so the tunnel
 * URL is resolved if active (same logic as the Vercel AI SDK path).
 */
function enrichWorkflowEmbedPayload(embed: WorkflowEmbedPayload): WorkflowEmbedPayload {
  // The middleware expects a YagrToolEvent — adapt, enrich, then extract back.
  const fakeEvent = {
    type: 'embed' as const,
    toolName: 'presentWorkflowResult',
    kind: 'workflow' as const,
    workflowId: embed.workflowId,
    url: embed.url,
    targetUrl: embed.targetUrl,
    title: embed.title,
    diagram: embed.diagram,
    executionResult: embed.executionResult,
  };
  const enriched = enrichWorkflowEmbed(fakeEvent) as Extract<YagrToolEvent, { type: 'embed' }>;
  return {
    ...embed,
    url: enriched.url ?? embed.url,
    targetUrl: enriched.targetUrl ?? embed.targetUrl,
    title: enriched.title ?? embed.title,
    diagram: enriched.diagram ?? embed.diagram,
  };
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
