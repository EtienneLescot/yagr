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

function preserveBody(text: string): string {
  return text;
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

function extractWorkflowEmbedFromText(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = tryParseJsonObject(trimmed) ?? extractLeadingJsonObject(trimmed);
  if (parsed?.__type === 'workflow-embed') {
    return parsed;
  }

  return undefined;
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
      if (looksLikeYagrProxyCommand(command)) {
        return {
          kind: 'operation',
          operationId,
          label: 'Configuring LLM relay',
          category: 'tool',
          status: 'running',
          summary: command.slice(0, 120),
          startedAt: now,
        };
      }

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

    case 'runShell':
    case 'runScript': {
      const command = typeof input?.command === 'string' ? input.command : '';
      const cwd = typeof input?.cwd === 'string' ? input.cwd : undefined;
      const label = toolName === 'runShell' ? 'Shell' : 'Script';
      const summary = command ? summarize(command, 80) : undefined;
      return {
        kind: 'operation',
        operationId,
        label: `${label}: ${summary || 'command'}`,
        category: 'tool',
        status: 'running',
        summary,
        startedAt: now,
      };
    }

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

function looksLikeYagrProxyCommand(command: string): boolean {
  return /(^|\s)(?:npx\s+)?yagr\s+yagrProxy(\s|$)/.test(command.trim());
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
    // deepagents execute tool returns a plain text string:
    // "<output>\n[Command succeeded with exit code 0]"
    const text = rawOutputToString(rawOutput).trimEnd();
    const exitMatch = text.match(/\[Command (?:succeeded|failed) with exit code (\d+)\]\s*$/);
    const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : undefined;
    const body = exitMatch ? text.slice(0, exitMatch.index).trimEnd() : text;
    const workflowEmbed = extractWorkflowEmbedFromText(body);
    if (workflowEmbed) {
      const title = typeof workflowEmbed.title === 'string' && workflowEmbed.title.trim()
        ? workflowEmbed.title.trim()
        : typeof workflowEmbed.workflowId === 'string' ? workflowEmbed.workflowId : 'workflow';
      return {
        ...base,
        status: exitCode !== undefined && exitCode !== 0 ? 'error' : 'done',
        body: '',
        summary: `Workflow ready  ${title}`,
      };
    }
    const lastLine = body.split('\n').reverse().find((l) => l.trim()) ?? '';
    return {
      ...base,
      status: exitCode !== undefined && exitCode !== 0 ? 'error' : 'done',
      body: preserveBody(body),
      summary: exitCode !== undefined ? `exit ${exitCode}${lastLine ? `  ${summarize(lastLine, 80)}` : ''}` : summarize(lastLine, 120),
    };
  }

  if (toolName === 'runShell' || toolName === 'runScript') {
    // runShell and runScript return { ok, command, exitCode, timedOut, stdout, stderr }
    const out = parseRawOutput(rawOutput);
    if (!out) {
      return base;
    }
    
    const exitCode = typeof out.exitCode === 'number' ? out.exitCode : undefined;
    const ok = out.ok === true;
    const stdout = typeof out.stdout === 'string' ? out.stdout : '';
    const stderr = typeof out.stderr === 'string' ? out.stderr : '';
    const command = typeof out.command === 'string' ? out.command : '';
    const workflowEmbed = extractWorkflowEmbedFromText(stdout);
    if (workflowEmbed) {
      const title = typeof workflowEmbed.title === 'string' && workflowEmbed.title.trim()
        ? workflowEmbed.title.trim()
        : typeof workflowEmbed.workflowId === 'string' ? workflowEmbed.workflowId : 'workflow';
      return {
        ...base,
        status: exitCode !== undefined && exitCode !== 0 ? 'error' : 'done',
        body: '',
        summary: `Workflow ready  ${title}`,
      };
    }
    
    // Combine stdout and stderr for display
    let output = '';
    if (stdout) output += stdout;
    if (stderr) output += (output ? '\n' : '') + stderr;
    
    // Extract last non-empty line for summary
    const lastLine = output.split('\n').reverse().find((l) => l.trim()) ?? '';
    
    return {
      ...base,
      status: exitCode !== undefined && exitCode !== 0 ? 'error' : 'done',
      body: preserveBody(output),
      summary: exitCode !== undefined ? `exit ${exitCode}${lastLine ? `  ${summarize(lastLine, 80)}` : ''}` : (ok ? 'OK' : 'Failed'),
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
  if (typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    // Unwrap LangChain ToolMessage: { lc:1, type:'constructor', id:[...,'ToolMessage'], kwargs:{content,...} }
    if (r['type'] === 'constructor' && r['kwargs'] != null && typeof r['kwargs'] === 'object') {
      return r['kwargs'] as Record<string, unknown>;
    }
    return r;
  }
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
