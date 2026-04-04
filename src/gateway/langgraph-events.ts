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
 *
 * The adapter is purely functional — callers own the accumulator state and
 * pass callbacks for side-effects (e.g. writing SSE frames, sending Telegram
 * messages).  This makes it straightforward to unit-test.
 */
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { YagrRequiredAction, YagrToolEvent } from '../types.js';
import type { YagrUserVisibleUpdate } from '../runtime/user-visible-updates.js';
import { WORKFLOW_EMBED_TYPE, type WorkflowEmbedPayload } from '../manager-tooling/langchain/index.js';
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
}

export interface LangGraphEventCallbacks {
  onTextDelta?: (delta: string) => void | Promise<void>;
  onUserVisibleUpdate?: (update: YagrUserVisibleUpdate) => void | Promise<void>;
  onWorkflowEmbed?: (embed: WorkflowEmbedPayload) => void | Promise<void>;
}

export function createRunAccumulator(): LangGraphRunAccumulator {
  return { responseText: '', requiredActions: [], workflowEmbeds: [] };
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
      const delta = extractTextDelta(event.data?.chunk);
      if (delta) {
        accumulator.responseText += delta;
        await callbacks.onTextDelta?.(delta);
      }
      break;
    }

    case 'on_tool_start': {
      const update = mapToolStartToUpdate(event.name, event.data?.input as Record<string, unknown> | undefined);
      if (update) {
        await callbacks.onUserVisibleUpdate?.(update);
      }
      break;
    }

    case 'on_tool_end': {
      await handleToolEnd(event.name, event.data?.output, accumulator, callbacks);
      break;
    }

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Text delta extraction
// ---------------------------------------------------------------------------

function extractTextDelta(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') {
    return '';
  }

  const c = chunk as Record<string, unknown>;

  // AIMessageChunk.content — may be a string or an array of content parts
  const content = c['content'];

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          return typeof p['text'] === 'string' ? p['text'] : '';
        }
        return '';
      })
      .join('');
  }

  return '';
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
