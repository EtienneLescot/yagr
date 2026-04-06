import { randomUUID } from 'node:crypto';
import type { YagrOperationCategory, YagrOperationEvent, YagrPhaseEvent, YagrRunPhase, YagrStateEvent, YagrToolEvent } from '../types.js';
import { getUserFacingToolStatus } from '../tools/observer.js';

export interface YagrUserVisibleUpdate {
  tone: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
  phase?: YagrRunPhase;
  dedupeKey: string;
}

const OPERATION_BODY_LIMIT = 4000;

function capBody(text: string): string {
  return text.length > OPERATION_BODY_LIMIT ? `${text.slice(0, OPERATION_BODY_LIMIT)}…` : text;
}

function summarize(text: string, max = 120): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? text;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---------------------------------------------------------------------------
// Phase → operation event
// ---------------------------------------------------------------------------

const PHASE_INDICES: Record<YagrRunPhase, number> = {
  inspect: 1, plan: 2, edit: 3, summarize: 4,
};

export function makePhaseOperationEvent(event: YagrPhaseEvent): YagrOperationEvent {
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

function phaseLabel(phase: YagrRunPhase): string {
  switch (phase) {
    case 'inspect': return 'Inspect';
    case 'plan': return 'Plan';
    case 'edit': return 'Edit';
    case 'summarize': return 'Summarize';
    default: return 'Phase';
  }
}

// ---------------------------------------------------------------------------
// Tool-start → operation event
// ---------------------------------------------------------------------------

export function makeToolStartOperationEvent(
  toolName: string,
  rawInput: Record<string, unknown> | undefined,
): YagrOperationEvent | undefined {
  // LangGraph may pass input as a JSON string in some adapters
  let input: Record<string, unknown> | undefined = rawInput;
  if (typeof rawInput === 'string') {
    try { input = JSON.parse(rawInput) as Record<string, unknown>; } catch { input = undefined; }
  }
  const operationId = `tool:${toolName}:${randomUUID()}`;
  const now = Date.now();

  switch (toolName) {
    case 'execute': {
      const command = typeof input?.command === 'string' ? input.command : '';
      return {
        kind: 'operation',
        operationId,
        label: `Shell: ${command.slice(0, 80)}`,
        category: 'shell',
        status: 'running',
        summary: command.slice(0, 120),
        startedAt: now,
      };
    }

    case 'readFile':
    case 'read_file': {
      const p = typeof input?.path === 'string' ? input.path : (typeof input?.file_path === 'string' ? input.file_path : '');
      return {
        kind: 'operation',
        operationId,
        label: `Read ${p}`,
        category: 'file-read',
        status: 'running',
        summary: p,
        startedAt: now,
      };
    }

    case 'writeFile':
    case 'write_file':
    case 'writeWorkspaceFile': {
      const p = typeof input?.path === 'string' ? input.path : (typeof input?.file_path === 'string' ? input.file_path : '');
      return {
        kind: 'operation',
        operationId,
        label: `Write ${p}`,
        category: 'file-write',
        status: 'running',
        summary: p,
        startedAt: now,
      };
    }

    case 'httpRequest': {
      const method = typeof input?.method === 'string' ? input.method : 'GET';
      const url = typeof input?.url === 'string' ? input.url : '';
      return {
        kind: 'operation',
        operationId,
        label: `${method} ${url.slice(0, 80)}`,
        category: 'web',
        status: 'running',
        summary: url.slice(0, 120),
        startedAt: now,
      };
    }

    case 'yagrProxy': {
      return {
        kind: 'operation',
        operationId: 'tool:yagrProxy',
        label: 'Configuring LLM relay',
        category: 'tool',
        status: 'running',
        startedAt: now,
      };
    }

    case 'write_todos': {
      return {
        kind: 'operation',
        operationId: 'tool:write_todos',
        label: 'Planning',
        category: 'phase',
        status: 'running',
        startedAt: now,
        phase: 'plan',
      };
    }

    case 'edit_file': {
      const p = typeof input?.path === 'string' ? input.path : (typeof input?.file_path === 'string' ? input.file_path : '');
      return {
        kind: 'operation',
        operationId,
        label: `Edit ${p}`,
        category: 'file-write',
        status: 'running',
        summary: p,
        startedAt: now,
      };
    }

    case 'task': {
      const taskName = typeof input?.name === 'string' ? input.name : (typeof input?.description === 'string' ? input.description.slice(0, 60) : 'task');
      return {
        kind: 'operation',
        operationId,
        label: taskName,
        category: 'agent',
        status: 'running',
        startedAt: now,
      };
    }

    case 'reportProgress':
    case 'requestRequiredAction':
    case 'presentWorkflowResult':
      // handled separately
      return undefined;

    case 'ls':
    case 'glob':
    case 'grep':
      return undefined;

    default: {
      if (!toolName) return undefined;
      const detail = input ? Object.values(input).find((v) => typeof v === 'string') as string | undefined : undefined;
      return {
        kind: 'operation',
        operationId,
        label: toolName,
        category: categoryForTool(toolName),
        status: 'running',
        summary: detail ? summarize(detail) : undefined,
        startedAt: now,
      };
    }
  }
}

function categoryForTool(toolName: string): YagrOperationCategory {
  if (toolName.toLowerCase().includes('agent') || toolName.toLowerCase().includes('deepagent')) {
    return 'agent';
  }
  return 'tool';
}

// ---------------------------------------------------------------------------
// Tool-end → operation event update
// ---------------------------------------------------------------------------

export function makeToolEndOperationEvent(
  operationId: string,
  toolName: string,
  rawOutput: unknown,
  startedAt: number,
): Partial<YagrOperationEvent> {
  const ended = Date.now();
  const base: Partial<YagrOperationEvent> = { status: 'done', endedAt: ended };

  if (toolName === 'execute') {
    const out = parseRawOutput(rawOutput);
    const exitCode = typeof out?.exitCode === 'number' ? out.exitCode : (typeof out?.exit_code === 'number' ? out.exit_code : undefined);
    const stdout = typeof out?.stdout === 'string' ? out.stdout.trimEnd() : '';
    const stderr = typeof out?.stderr === 'string' ? out.stderr.trimEnd() : '';
    const sections: string[] = [];
    if (stdout) sections.push(`stdout\n${stdout}`);
    if (stderr) sections.push(`stderr\n${stderr}`);
    if (exitCode !== undefined) sections.push(`exit ${exitCode}`);
    const body = sections.join('\n\n');
    const lastLine = [...stdout.split('\n')].reverse().find((l) => l.trim()) ?? '';
    return {
      ...base,
      status: exitCode !== undefined && exitCode !== 0 ? 'error' : 'done',
      body: capBody(body),
      summary: exitCode !== undefined ? `exit ${exitCode}${lastLine ? `  ${summarize(lastLine, 80)}` : ''}` : summarize(lastLine, 120),
    };
  }

  if (toolName === 'readFile' || toolName === 'read_file') {
    const content = rawOutputToString(rawOutput);
    const lines = content.split('\n');
    return {
      ...base,
      body: capBody(content),
      summary: `${lines.length} lines`,
    };
  }

  if (toolName === 'write_file' || toolName === 'writeFile' || toolName === 'writeWorkspaceFile') {
    const content = rawOutputToString(rawOutput);
    const lines = content.split('\n').length;
    return { ...base, summary: `${lines} lines written` };
  }

  if (toolName === 'httpRequest') {
    const out = parseRawOutput(rawOutput);
    const status = typeof out?.statusCode === 'number' ? out.statusCode : (typeof out?.status === 'number' ? out.status : undefined);
    const body = rawOutputToString(rawOutput);
    return {
      ...base,
      body: capBody(body),
      summary: status !== undefined ? `HTTP ${status} · ${body.length} bytes` : summarize(body, 120),
    };
  }

  return base;
}

function parseRawOutput(raw: unknown): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === 'object' ? (p as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return undefined;
}

function rawOutputToString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  const out = parseRawOutput(raw);
  if (!out) return '';
  if (typeof out.content === 'string') return out.content;
  if (typeof out.result === 'string') return out.result;
  if (typeof out.output === 'string') return out.output;
  return JSON.stringify(out);
}

// ---------------------------------------------------------------------------
// Thinking operation helpers (called from langgraph-events)
// ---------------------------------------------------------------------------

export const THINKING_OP_ID = 'llm:thinking';

export function makeThinkingStartEvent(): YagrOperationEvent {
  return {
    kind: 'operation',
    operationId: THINKING_OP_ID,
    label: 'Thinking…',
    category: 'thinking',
    status: 'running',
    startedAt: Date.now(),
  };
}

export function makeThinkingEndEvent(body: string, startedAt: number): Partial<YagrOperationEvent> {
  const lines = body.split('\n').length;
  return {
    status: 'done',
    endedAt: Date.now(),
    body: capBody(body),
    summary: `${lines} lines · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  };
}


function phaseTitle(phase: YagrRunPhase): string {
  switch (phase) {
    case 'inspect':
      return 'Inspect';
    case 'plan':
      return 'Plan';
    case 'edit':
      return 'Edit';
    case 'summarize':
      return 'Summarize';
    default:
      return 'Progress';
  }
}

export function mapPhaseEventToUserVisibleUpdate(event: YagrPhaseEvent): YagrUserVisibleUpdate | undefined {
  if (event.status !== 'started') {
    return undefined;
  }

  return {
    tone: 'info',
    title: phaseTitle(event.phase),
    detail: event.message,
    phase: event.phase,
    dedupeKey: `phase:${event.phase}:${event.status}:${event.message}`,
  };
}

export function mapStateEventToUserVisibleUpdate(event: YagrStateEvent): YagrUserVisibleUpdate | undefined {
  switch (event.state) {
    case 'waiting_for_permission':
      return {
        tone: 'info',
        title: 'Needs permission',
        detail: event.message,
        phase: event.phase,
        dedupeKey: `state:${event.state}:${event.message}`,
      };
    case 'waiting_for_input':
      return {
        tone: 'info',
        title: 'Needs input',
        detail: event.message,
        phase: event.phase,
        dedupeKey: `state:${event.state}:${event.message}`,
      };
    case 'resumable':
      return {
        tone: 'info',
        title: 'Ready to resume',
        detail: event.message,
        phase: event.phase,
        dedupeKey: `state:${event.state}:${event.message}`,
      };
    case 'failed_terminal':
      return {
        tone: 'error',
        title: 'Run failed',
        detail: event.message,
        phase: event.phase,
        dedupeKey: `state:${event.state}:${event.message}`,
      };
    default:
      return undefined;
  }
}

export function mapToolEventToUserVisibleUpdate(event: YagrToolEvent): YagrUserVisibleUpdate | undefined {
  const userFacingStatus = getUserFacingToolStatus(event);
  if (userFacingStatus) {
    const message = event.type === 'status' ? event.message : userFacingStatus.detail;
    return {
      tone: 'info',
      title: userFacingStatus.title,
      detail: userFacingStatus.detail,
      dedupeKey: `tool:${event.toolName}:${message}`,
    };
  }

  if (event.type === 'command-end' && event.exitCode !== 0) {
    return {
      tone: 'info',
      title: 'Correcting commands',
      detail: event.message,
      dedupeKey: `tool:${event.toolName}:command-end:${event.exitCode}:${event.message ?? ''}`,
    };
  }

  return undefined;
}
