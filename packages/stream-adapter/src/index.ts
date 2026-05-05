import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import {
  extractCompactionFromChunk,
  extractContextUsageEvent,
  extractDeltas,
  makeGenericToolStartOperationEvent,
  makeThinkingEndEvent,
  makeThinkingStartEvent,
  makeToolEndOperationEvent,
  THINKING_OPERATION_ID,
  type RuntimeContextCompactionEvent,
  type RuntimeContextUsageEvent,
  type RuntimeOperationEvent,
} from '@yagr/runtime-events';

export interface LangGraphStreamAccumulator {
  responseText: string;
  thinkingText: string;
  thinkingStartedAt: number;
  activeOperations: Map<string, RuntimeOperationEvent>;
  compactions: RuntimeContextCompactionEvent[];
  contextUsages: RuntimeContextUsageEvent[];
  emittedUsageKeys: Set<string>;
}

export interface LangGraphStreamCallbacks {
  onTextDelta?: (delta: string) => void | Promise<void>;
  onThinkingDelta?: (delta: string) => void | Promise<void>;
  onOperation?: (event: RuntimeOperationEvent) => void | Promise<void>;
  onCompaction?: (event: RuntimeContextCompactionEvent) => void | Promise<void>;
  onContextUsage?: (event: RuntimeContextUsageEvent) => void | Promise<void>;
  contextWindowTokens?: number;
}

export function createLangGraphStreamAccumulator(): LangGraphStreamAccumulator {
  return {
    responseText: '',
    thinkingText: '',
    thinkingStartedAt: 0,
    activeOperations: new Map(),
    compactions: [],
    contextUsages: [],
    emittedUsageKeys: new Set(),
  };
}

export async function consumeLangGraphStream(
  stream: AsyncIterable<StreamEvent>,
  callbacks: LangGraphStreamCallbacks = {},
): Promise<LangGraphStreamAccumulator> {
  const accumulator = createLangGraphStreamAccumulator();
  for await (const event of stream) {
    await processLangGraphStreamEvent(event, accumulator, callbacks);
  }
  if (accumulator.thinkingText.length > 0 && !accumulator.activeOperations.has('thinking:closed')) {
    await callbacks.onOperation?.({
      kind: 'operation',
      operationId: THINKING_OPERATION_ID,
      label: 'Thinking',
      category: 'thinking',
      ...makeThinkingEndEvent(accumulator.thinkingText, accumulator.thinkingStartedAt),
    } as RuntimeOperationEvent);
  }
  return accumulator;
}

export async function processLangGraphStreamEvent(
  event: StreamEvent,
  accumulator: LangGraphStreamAccumulator,
  callbacks: LangGraphStreamCallbacks = {},
): Promise<void> {
  switch (event.event) {
    case 'on_chat_model_stream': {
      const { textDelta, thinkingDelta } = extractDeltas(event.data?.chunk);
      await emitContextUsage(event, event.data?.chunk, accumulator, callbacks);
      if (thinkingDelta) {
        const firstThinking = accumulator.thinkingText.length === 0;
        accumulator.thinkingText += thinkingDelta;
        if (firstThinking) {
          const start = makeThinkingStartEvent();
          accumulator.thinkingStartedAt = start.startedAt;
          await callbacks.onOperation?.(start);
        } else {
          await callbacks.onOperation?.({
            kind: 'operation',
            operationId: THINKING_OPERATION_ID,
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
        if (accumulator.thinkingText.length > 0 && !accumulator.activeOperations.has('thinking:closed')) {
          accumulator.activeOperations.set('thinking:closed', {
            kind: 'operation',
            operationId: THINKING_OPERATION_ID,
            label: 'Thinking',
            category: 'thinking',
            status: 'done',
            startedAt: accumulator.thinkingStartedAt,
          });
          await callbacks.onOperation?.({
            kind: 'operation',
            operationId: THINKING_OPERATION_ID,
            label: 'Thinking',
            category: 'thinking',
            ...makeThinkingEndEvent(accumulator.thinkingText, accumulator.thinkingStartedAt),
          } as RuntimeOperationEvent);
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
      const toolName = event.name || 'tool';
      const operationKey = getToolOperationKey(event);
      const input = normalizeEventInput(event.data?.input as Record<string, unknown> | undefined);
      const operation = makeGenericToolStartOperationEvent(toolName, input);
      accumulator.activeOperations.set(operationKey, operation);
      await callbacks.onOperation?.(operation);
      break;
    }
    case 'on_tool_end': {
      const toolName = event.name || 'tool';
      const operationKey = getToolOperationKey(event);
      const active = accumulator.activeOperations.get(operationKey);
      if (active) {
        await callbacks.onOperation?.({
          ...active,
          ...makeToolEndOperationEvent(active.operationId, toolName, event.data?.output, active.startedAt),
        });
        accumulator.activeOperations.delete(operationKey);
      }
      break;
    }
    case 'on_llm_new_token':
    case 'on_chain_stream':
    case 'on_chain_end': {
      const compaction = extractCompactionFromChunk(event.data?.chunk);
      if (compaction) {
        accumulator.compactions.push(compaction);
        await callbacks.onCompaction?.(compaction);
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
  accumulator: LangGraphStreamAccumulator,
  callbacks: LangGraphStreamCallbacks,
): Promise<void> {
  const usage = extractContextUsageEvent(payload, callbacks.contextWindowTokens);
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

function getToolOperationKey(event: StreamEvent): string {
  const toolName = event.name || 'tool';
  const runId = typeof event.run_id === 'string' && event.run_id.length > 0 ? event.run_id : 'unknown';
  return `${toolName}:${runId}`;
}

function normalizeEventInput(rawInput: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const inner = rawInput?.input;
  if (typeof inner === 'string') {
    try {
      return JSON.parse(inner) as Record<string, unknown>;
    } catch {
      return rawInput;
    }
  }
  if (inner && typeof inner === 'object') {
    return inner as Record<string, unknown>;
  }
  return rawInput;
}
