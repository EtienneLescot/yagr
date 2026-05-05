import { randomUUID } from 'node:crypto';

export type RuntimePhase = 'inspect' | 'plan' | 'edit' | 'summarize';
export type RuntimeOperationCategory = 'phase' | 'tool' | 'shell' | 'web' | 'file-read' | 'file-write' | 'agent' | 'thinking';

export interface RuntimeUserVisibleUpdate {
  tone: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
  phase?: RuntimePhase;
  dedupeKey: string;
}

export interface RuntimeOperationEvent {
  kind: 'operation';
  operationId: string;
  label: string;
  category: RuntimeOperationCategory;
  status: 'running' | 'done' | 'error';
  inputSummary?: string;
  summary?: string;
  body?: string;
  startedAt: number;
  endedAt?: number;
  phase?: RuntimePhase;
}

export interface RuntimePhaseEvent {
  phase: RuntimePhase;
  status: 'started' | 'completed';
  message: string;
}

export interface RuntimeContextCompactionEvent {
  summary: string;
  source: 'llm' | 'fallback';
  estimatedTokens?: number;
  thresholdTokens?: number;
  messagesCompacted: number;
  preservedRecentMessages: number;
  fallbackReason?: string;
}

export interface RuntimeContextUsageEvent {
  type: 'context-usage';
  promptTokens: number;
  completionTokens: number;
  contextWindowTokens: number;
  fillPercent: number;
  source: 'api' | 'estimated';
}

export interface RuntimeTokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ExtractedDeltas {
  textDelta: string;
  thinkingDelta: string;
}

export const THINKING_OPERATION_ID = 'operation:thinking';

const PHASE_INDICES: Record<RuntimePhase, number> = {
  inspect: 1,
  plan: 2,
  edit: 3,
  summarize: 4,
};

export function makePhaseOperationEvent(event: RuntimePhaseEvent): RuntimeOperationEvent {
  const idx = PHASE_INDICES[event.phase] ?? 0;
  return {
    kind: 'operation',
    operationId: `phase:${event.phase}`,
    label: `${phaseLabel(event.phase)} (${idx}/4)`,
    category: 'phase',
    status: event.status === 'completed' ? 'done' : 'running',
    summary: event.message,
    body: event.message,
    startedAt: Date.now(),
    phase: event.phase,
  };
}

export function makeGenericToolStartOperationEvent(
  toolName: string,
  input: Record<string, unknown> | undefined,
): RuntimeOperationEvent {
  const operationId = `tool:${toolName}:${randomUUID()}`;
  const summary = summarizeToolInput(toolName, input);
  return {
    kind: 'operation',
    operationId,
    label: summary ? `${toolName}: ${summary.slice(0, 80)}` : toolName,
    category: inferOperationCategory(toolName),
    status: 'running',
    inputSummary: summary,
    summary,
    startedAt: Date.now(),
  };
}

export function makeToolEndOperationEvent(
  operationId: string,
  toolName: string,
  rawOutput: unknown,
  startedAt: number,
): Partial<RuntimeOperationEvent> {
  const summary = typeof rawOutput === 'string'
    ? truncate(rawOutput, 120)
    : rawOutput && typeof rawOutput === 'object'
      ? truncate(JSON.stringify(rawOutput), 120)
      : undefined;

  return {
    operationId,
    label: toolName,
    category: inferOperationCategory(toolName),
    status: 'done',
    summary,
    endedAt: Date.now(),
    startedAt,
  };
}

export function makeThinkingStartEvent(): RuntimeOperationEvent {
  return {
    kind: 'operation',
    operationId: THINKING_OPERATION_ID,
    label: 'Thinking…',
    category: 'thinking',
    status: 'running',
    startedAt: Date.now(),
  };
}

export function makeThinkingEndEvent(
  body: string,
  startedAt: number,
): Partial<RuntimeOperationEvent> {
  return {
    status: 'done',
    body,
    startedAt,
    endedAt: Date.now(),
  };
}

export function extractDeltas(chunk: unknown): ExtractedDeltas {
  if (!chunk || typeof chunk !== 'object') {
    return { textDelta: '', thinkingDelta: '' };
  }
  const c = chunk as Record<string, unknown>;
  const content = c.content;
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
        if (p.type === 'thinking' && typeof p.thinking === 'string') {
          thinking += p.thinking;
          continue;
        }
        if (p.type === 'reasoning' && typeof p.reasoning_content === 'string') {
          thinking += p.reasoning_content;
          continue;
        }
        if (typeof p.text === 'string') {
          text += p.text;
        }
      }
    }
  }

  const additionalKwargs = c.additional_kwargs as Record<string, unknown> | undefined;
  if (typeof additionalKwargs?.reasoning_content === 'string' && additionalKwargs.reasoning_content.length > 0) {
    thinking += additionalKwargs.reasoning_content;
  }

  return { textDelta: text, thinkingDelta: thinking };
}

export function extractCompactionFromChunk(chunk: unknown): RuntimeContextCompactionEvent | null {
  if (!chunk || typeof chunk !== 'object') {
    return null;
  }
  const c = chunk as Record<string, unknown>;
  if (c.type === 'compaction' || c.__type === 'compaction' || c.type === 'context_compaction') {
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

export function extractTokenUsageMetadata(payload: unknown): RuntimeTokenUsage | null {
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

export function extractContextUsageEvent(
  payload: unknown,
  contextWindowTokens?: number,
): RuntimeContextUsageEvent | null {
  if (!contextWindowTokens || contextWindowTokens <= 0) {
    return null;
  }
  const usage = extractTokenUsageMetadata(payload);
  if (!usage) {
    return null;
  }
  const totalTokens = usage.promptTokens + usage.completionTokens;
  return {
    type: 'context-usage',
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    contextWindowTokens,
    fillPercent: clampPercent(Math.round((totalTokens / contextWindowTokens) * 100)),
    source: 'api',
  };
}

function normalizeTokenUsage(obj: Record<string, unknown>): RuntimeTokenUsage | null {
  const promptTokens = firstNumber(
    obj.promptTokens,
    obj.inputTokens,
    obj.prompt_tokens,
    obj.input_tokens,
  );
  const completionTokens = firstNumber(
    obj.completionTokens,
    obj.outputTokens,
    obj.completion_tokens,
    obj.output_tokens,
  );
  if (promptTokens === undefined || completionTokens === undefined) {
    return null;
  }
  return { promptTokens, completionTokens };
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function summarizeToolInput(toolName: string, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  if (typeof input.command === 'string') return input.command;
  if (typeof input.path === 'string') return input.path;
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.url === 'string') return `${input.method ?? 'GET'} ${input.url}`;
  if (typeof input.prompt === 'string' && toolName === 'run_rewrite_planner') return truncate(input.prompt, 80);
  return undefined;
}

function inferOperationCategory(toolName: string): RuntimeOperationCategory {
  if (toolName.includes('read')) return 'file-read';
  if (toolName.includes('write') || toolName.includes('edit')) return 'file-write';
  if (toolName.includes('shell') || toolName.includes('execute')) return 'shell';
  if (toolName.includes('http')) return 'web';
  if (toolName.includes('agent') || toolName.includes('task')) return 'agent';
  return 'tool';
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function phaseLabel(phase: RuntimePhase): string {
  switch (phase) {
    case 'inspect': return 'Inspect';
    case 'plan': return 'Plan';
    case 'edit': return 'Edit';
    case 'summarize': return 'Summarize';
  }
}
