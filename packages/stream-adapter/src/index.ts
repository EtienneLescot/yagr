import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { ImpactLedger } from '@yagr/impact-ledger';
import { recordRuntimeOperationImpact, type RuntimeImpactContext } from '@yagr/reality-observer';
import {
  extractCompactionFromChunk,
  extractContextUsageEvent,
  extractDeltas,
  makeGenericToolStartOperationEvent,
  makeThinkingEndEvent,
  makeThinkingStartEvent,
  makeToolEndOperationEvent,
  mapToolStartToUserVisibleUpdate,
  THINKING_OPERATION_ID,
  type RuntimeContextCompactionEvent,
  type RuntimeContextUsageEvent,
  type RuntimeOperationEvent,
  type RuntimeRequiredAction,
  type RuntimeUserVisibleUpdate,
} from '@yagr/runtime-events';

export interface LangGraphStreamAccumulator {
  responseText: string;
  requiredActions: RuntimeRequiredAction[];
  thinkingText: string;
  thinkingStartedAt: number;
  activeOperations: Map<string, RuntimeOperationEvent>;
  fileModificationDetected: boolean;
  compactions: RuntimeContextCompactionEvent[];
  contextUsages: RuntimeContextUsageEvent[];
  emittedUsageKeys: Set<string>;
}

export interface LangGraphStreamCallbacks {
  onTextDelta?: (delta: string) => void | Promise<void>;
  onThinkingDelta?: (delta: string) => void | Promise<void>;
  onUserVisibleUpdate?: (update: RuntimeUserVisibleUpdate) => void | Promise<void>;
  onOperation?: (event: RuntimeOperationEvent) => void | Promise<void>;
  onCompaction?: (event: RuntimeContextCompactionEvent) => void | Promise<void>;
  onContextUsage?: (event: RuntimeContextUsageEvent) => void | Promise<void>;
  impact?: {
    ledger: ImpactLedger;
    context: RuntimeImpactContext;
  };
  contextWindowTokens?: number;
}

export function createLangGraphStreamAccumulator(): LangGraphStreamAccumulator {
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
          await emitOperation(callbacks, start);
        } else {
          await emitOperation(callbacks, {
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
          await emitOperation(callbacks, {
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
      const update = mapToolStartToUserVisibleUpdate(toolName, input);
      if (update) {
        await callbacks.onUserVisibleUpdate?.(update);
      }
      if (!shouldEmitOperationForTool(toolName)) {
        break;
      }
      const operation = makeGenericToolStartOperationEvent(toolName, input);
      accumulator.activeOperations.set(operationKey, operation);
      await emitOperation(callbacks, operation);
      break;
    }
    case 'on_tool_end': {
      const toolName = event.name || 'tool';
      const operationKey = getToolOperationKey(event);
      const active = accumulator.activeOperations.get(operationKey);
      if (active) {
        await emitOperation(callbacks, {
          ...active,
          ...makeToolEndOperationEvent(active.operationId, toolName, event.data?.output, active.startedAt),
        });
        accumulator.activeOperations.delete(operationKey);
      }
      await handleToolEnd(toolName, event.data?.output, accumulator, callbacks);
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

async function emitOperation(callbacks: LangGraphStreamCallbacks, event: RuntimeOperationEvent): Promise<void> {
  await callbacks.onOperation?.(event);
  if (!callbacks.impact) {
    return;
  }
  try {
    recordRuntimeOperationImpact(callbacks.impact.ledger, callbacks.impact.context, event);
  } catch {
    // Impact recording must never affect the run stream.
  }
}

async function handleToolEnd(
  toolName: string,
  rawOutput: unknown,
  accumulator: LangGraphStreamAccumulator,
  callbacks: LangGraphStreamCallbacks,
): Promise<void> {
  switch (toolName) {
    case 'writeFile':
    case 'write_file':
    case 'writeWorkspaceFile':
    case 'edit_file':
    case 'deleteFile':
    case 'moveFile':
    case 'replaceInFile':
      accumulator.fileModificationDetected = true;
      break;
    case 'reportProgress': {
      const output = parseToolOutput(rawOutput);
      const message = output?.message;
      if (typeof message === 'string') {
        await callbacks.onUserVisibleUpdate?.({
          tone: 'info',
          title: 'Progress',
          detail: message,
          dedupeKey: `tool:reportProgress:${message}`,
        });
      }
      break;
    }
    case 'requestRequiredAction': {
      const output = parseToolOutput(rawOutput);
      if (isRequiredAction(output)) {
        accumulator.requiredActions.push(normalizeRequiredAction(output));
      }
      break;
    }
    default:
      break;
  }
}

function normalizeRequiredAction(output: Record<string, unknown>): RuntimeRequiredAction {
  const action: RuntimeRequiredAction = {
    id: String(output.id),
    kind: output.kind === 'permission' || output.kind === 'external' ? output.kind : 'input',
    title: String(output.title),
    message: String(output.message),
    resumable: output.resumable !== false,
  };
  if (typeof output.detail === 'string') {
    action.detail = output.detail;
  }
  if (typeof output.blocking === 'boolean') {
    action.blocking = output.blocking;
  }
  return action;
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

function shouldEmitOperationForTool(toolName: string): boolean {
  return toolName !== 'reportProgress'
    && toolName !== 'requestRequiredAction'
    && toolName !== 'ls'
    && toolName !== 'glob'
    && toolName !== 'grep';
}

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
      return parseJsonObjectFromText(stdout) || parsed;
    }
    return parsed;
  }
  if (typeof raw !== 'object') {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  if (obj.type === 'constructor' && obj.kwargs && typeof obj.kwargs === 'object') {
    return parseToolOutput(obj.kwargs);
  }
  for (const key of ['content', 'result', 'output', 'stdout']) {
    const value = obj[key];
    if (typeof value === 'string') {
      const parsed = parseJsonObjectFromText(value);
      if (parsed) {
        return parsed;
      }
    }
  }
  return obj;
}

function parseJsonObjectFromText(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return extractLeadingJsonObject(trimmed);
  }
}

function extractLeadingJsonObject(raw: string): Record<string, unknown> | undefined {
  if (!raw.startsWith('{')) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(raw.slice(0, index + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function isRequiredAction(obj: Record<string, unknown> | undefined): obj is Record<string, unknown> {
  return Boolean(
    obj &&
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.message === 'string',
  );
}

export function extractLastAiMessage(result: Record<string, unknown>): string {
  const messages = result?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown>;
    if (message && (String(message._getType || '').includes('ai') || message.role === 'assistant')) {
      const content = message.content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .filter((part): part is { type: string; text: string } => part?.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('');
      }
    }
  }
  return '';
}
