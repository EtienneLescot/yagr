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
  const display = normalizeToolOutputForDisplay(toolName, rawOutput);

  return {
    operationId,
    label: toolName,
    category: inferOperationCategory(toolName),
    status: display.status ?? 'done',
    summary: display.summary,
    body: display.body,
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

interface ToolOutputDisplay {
  status?: 'done' | 'error';
  summary?: string;
  body?: string;
}

const MAX_TOOL_BODY_CHARS = 20_000;

function normalizeToolOutputForDisplay(toolName: string, rawOutput: unknown): ToolOutputDisplay {
  const unwrapped = unwrapToolOutput(rawOutput);
  const commandSummary = summarizeLangGraphCommand(unwrapped);
  if (commandSummary) {
    return { summary: commandSummary };
  }

  const text = toolOutputToString(unwrapped)?.trimEnd();
  if (!text) {
    return {};
  }

  const exitMatch = text.match(/\[Command (?:succeeded|failed) with exit code (\d+)\]\s*$/);
  const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : undefined;
  const body = exitMatch ? text.slice(0, exitMatch.index).trimEnd() : text;
  const lastLine = body.split('\n').reverse().find((line) => line.trim())?.trim();

  if (toolName === 'execute' || exitCode !== undefined) {
    return {
      status: exitCode !== undefined && exitCode !== 0 ? 'error' : 'done',
      summary: exitCode !== undefined
        ? `exit ${exitCode}${lastLine ? `  ${truncate(lastLine, 80)}` : ''}`
        : truncate(lastLine || body, 120),
      body: capToolBody(body),
    };
  }

  return {
    summary: truncate(lastLine || text, 120),
    body: capToolBody(text),
  };
}

function unwrapToolOutput(rawOutput: unknown): unknown {
  if (typeof rawOutput === 'string') {
    const trimmed = rawOutput.trim();
    if (trimmed.startsWith('{') && (trimmed.includes('ToolMessage') || trimmed.includes('"lg_name"'))) {
      try {
        return unwrapToolOutput(JSON.parse(trimmed));
      } catch {
        return rawOutput;
      }
    }
    return rawOutput;
  }

  if (!isRecord(rawOutput)) {
    return rawOutput;
  }

  if (isSerializedToolMessage(rawOutput) && isRecord(rawOutput.kwargs)) {
    return unwrapToolOutput(rawOutput.kwargs.content);
  }

  return rawOutput;
}

function toolOutputToString(output: unknown): string | undefined {
  if (typeof output === 'string') {
    return output;
  }
  if (Array.isArray(output)) {
    return joinToolOutputParts(output.map(toolOutputToString));
  }
  if (!isRecord(output)) {
    return undefined;
  }
  if (typeof output.text === 'string') {
    return output.text;
  }
  if (typeof output.content === 'string') {
    return output.content;
  }
  if (Array.isArray(output.content)) {
    return toolOutputToString(output.content);
  }
  if (typeof output.result === 'string') {
    return output.result;
  }
  if (typeof output.output === 'string') {
    return output.output;
  }
  if (typeof output.stdout === 'string' || typeof output.stderr === 'string') {
    return joinToolOutputParts([output.stdout, output.stderr]);
  }
  try {
    return JSON.stringify(output);
  } catch {
    return undefined;
  }
}

function summarizeLangGraphCommand(output: unknown): string | undefined {
  if (!isRecord(output) || output.lg_name !== 'Command' || !isRecord(output.update)) {
    return undefined;
  }
  const keys = Object.keys(output.update).filter((key) => key !== '__root__');
  if (keys.includes('todos')) {
    return 'Updated todos';
  }
  if (keys.includes('messages')) {
    return 'Updated messages';
  }
  return keys.length ? `Updated ${keys.join(', ')}` : 'Updated state';
}

function isSerializedToolMessage(value: Record<string, unknown>): boolean {
  return value.lc === 1 &&
    value.type === 'constructor' &&
    Array.isArray(value.id) &&
    value.id.some((part) => part === 'ToolMessage');
}

function joinToolOutputParts(parts: unknown[]): string | undefined {
  const text = parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n');
  return text || undefined;
}

function capToolBody(text: string): string | undefined {
  if (!text) {
    return undefined;
  }
  return text.length > MAX_TOOL_BODY_CHARS
    ? `${text.slice(0, MAX_TOOL_BODY_CHARS)}\n[output truncated]`
    : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function phaseLabel(phase: RuntimePhase): string {
  switch (phase) {
    case 'inspect': return 'Inspect';
    case 'plan': return 'Plan';
    case 'edit': return 'Edit';
    case 'summarize': return 'Summarize';
  }
}
