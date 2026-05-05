import {
  getCommandsForSurface,
  parseSlashInput,
  type ParsedSlashInput,
  type SlashCommandMeta,
  type SlashSurface,
} from '@yagr/conversation-core';
import { buildImpactSummary, type ImpactLedger, type ImpactLedgerQuery } from '@yagr/impact-ledger';
import type { CheckpointMetadata, CheckpointReason, DeepAgentSessionScope, SessionService } from '@yagr/session-service';

export interface SessionListEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  isClosed: boolean;
}

export interface CheckpointListEntry {
  id: string;
  sessionId: string;
  createdAt: string;
  messageCount: number;
  summary?: string;
  reason?: CheckpointReason;
  label?: string;
  restoredAt?: string;
}

export type SlashCommandResultKind =
  | 'ok'
  | 'error'
  | 'unknown_command'
  | 'invalid_arguments'
  | 'unsupported_in_surface'
  | 'session_not_found'
  | 'checkpoint_not_found';

export interface SlashCommandResult {
  kind: SlashCommandResultKind;
  message: string;
  data?: unknown;
}

export interface SlashCommandContext {
  surface: SlashSurface;
  sessionId: string;
  threadId: string;
}

export interface SlashHandler {
  getActiveSessionId(scope: DeepAgentSessionScope): string | undefined;
  resumeSession(scope: DeepAgentSessionScope, sessionId: string): void;
  resetLocalState(): void;
  approvePendingPermissions?(): Promise<number> | number;
  getDisplayOptions?(): { showThinking: boolean; showExecution: boolean };
  setDisplayOptions?(opts: { showThinking?: boolean; showExecution?: boolean }): void;
}

export interface CheckpointPayloadManager {
  getState(sessionId: string): unknown;
  setState(sessionId: string, state: unknown): void;
  reset(sessionId?: string): void;
}

export class SlashCommandService {
  constructor(
    private readonly sessions: SessionService,
    private readonly checkpointPayloads: CheckpointPayloadManager,
    private readonly impactLedger?: ImpactLedger,
  ) {}

  parse(raw: string): ParsedSlashInput | undefined {
    return parseSlashInput(raw);
  }

  async execute(input: ParsedSlashInput, ctx: SlashCommandContext, handler: SlashHandler): Promise<SlashCommandResult> {
    const { command, args } = input;

    switch (command) {
      case 'help':
        return this.buildHelpResult(ctx.surface);
      case 'sessions':
        return this.buildSessionsResult(ctx);
      case 'resume':
        return this.executeResume(args, ctx, handler);
      case 'delete':
        return this.executeDelete(args, ctx, handler);
      case 'new':
      case 'reset':
        return this.executeNew(ctx, handler);
      case 'impact':
        return this.buildImpactResult(args, ctx);
      case 'checkpoints':
        return this.buildCheckpointsResult(ctx);
      case 'save':
        return this.executeSaveCheckpoint(ctx);
      case 'restore':
        return this.executeRestore(args, ctx, handler);
      case 'checkpoint_delete':
        return this.executeDeleteCheckpoint(args, ctx);
      case 'pending':
        return { kind: 'ok', message: 'Use the pending actions display in the UI.' };
      case 'approve':
        if (!handler.approvePendingPermissions) {
          return { kind: 'unsupported_in_surface', message: '/approve is not available in this surface.' };
        }
        return this.executeApprove(handler);
      case 'compact':
        return { kind: 'ok', message: 'Compaction runs automatically when needed.' };
      case 'toggle_thinking':
        if (handler.setDisplayOptions) {
          const current = handler.getDisplayOptions?.() ?? { showThinking: true, showExecution: true };
          handler.setDisplayOptions({ showThinking: !current.showThinking });
          return { kind: 'ok', message: `Thinking display ${!current.showThinking ? 'hidden' : 'visible'}.` };
        }
        return { kind: 'unsupported_in_surface', message: '/toggle_thinking is not available in this surface.' };
      case 'toggle_cli':
        if (handler.setDisplayOptions) {
          const current = handler.getDisplayOptions?.() ?? { showThinking: true, showExecution: true };
          handler.setDisplayOptions({ showExecution: !current.showExecution });
          return { kind: 'ok', message: `Command executions display ${!current.showExecution ? 'hidden' : 'visible'}.` };
        }
        return { kind: 'unsupported_in_surface', message: '/toggle_cli is not available in this surface.' };
      case 'stop':
        return { kind: 'ok', message: 'Stop signalled. Finish current operation and wait for it to complete.' };
      case 'exit':
        return { kind: 'ok', message: '/exit' };
      default:
        return { kind: 'unknown_command', message: `Unknown command: /${command}` };
    }
  }

  buildHelpResult(surface: SlashSurface): SlashCommandResult {
    const commands = getCommandsForSurface(surface);
    const lines = commands.map(
      (c) => `${c.usage.padEnd(32)} — ${c.description}${c.aliases.length > 0 ? ` (alias: ${c.aliases.map((a) => `/${a}`).join(', ')})` : ''}`,
    );
    return {
      kind: 'ok',
      message: `Available commands:\n${lines.join('\n')}`,
      data: { commands },
    };
  }

  private async executeApprove(handler: SlashHandler): Promise<SlashCommandResult> {
    const approvedCount = await handler.approvePendingPermissions?.();
    if (!approvedCount) {
      return { kind: 'ok', message: 'No permissions pending.', data: { approvedCount: 0 } };
    }
    return {
      kind: 'ok',
      message: `Permission granted for ${approvedCount} action(s).`,
      data: {
        approvedCount,
        resumePrompt: 'Permission granted. Continue the current task and execute the previously blocked step now.',
      },
    };
  }

  private buildSessionsResult(ctx: SlashCommandContext): SlashCommandResult {
    const scope: DeepAgentSessionScope = { kind: ctx.surface, key: ctx.sessionId };
    const sessions = this.sessions.listForScope(scope);
    const activeId = this.sessions.getActiveForScope(scope)?.id;

    if (sessions.length === 0) {
      return { kind: 'ok', message: 'No sessions found.', data: { sessions: [] } };
    }

    const entries: SessionListEntry[] = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      isActive: s.id === activeId,
      isClosed: Boolean(s.closedAt),
    }));

    const lines = entries.map((e) => {
      const activeMarker = e.isActive ? ' [ACTIVE]' : '';
      const closedMarker = e.isClosed ? ' [CLOSED]' : '';
      const date = new Date(e.updatedAt).toLocaleString();
      return `${e.id}  "${e.title}"${activeMarker}${closedMarker}  ${date}`;
    });

    return {
      kind: 'ok',
      message: `Sessions:\n${lines.join('\n')}`,
      data: { sessions: entries },
    };
  }

  private buildImpactResult(args: string[], ctx: SlashCommandContext): SlashCommandResult {
    if (!this.impactLedger) {
      return { kind: 'unsupported_in_surface', message: 'Impact ledger is not available in this runtime.' };
    }

    const query = parseImpactArgs(args, ctx.threadId);
    const summary = buildImpactSummary(this.impactLedger, query);
    return {
      kind: 'ok',
      message: summary.message,
      data: { events: summary.events },
    };
  }

  private executeResume(args: string[], ctx: SlashCommandContext, handler: SlashHandler): SlashCommandResult {
    if (args.length === 0) {
      return { kind: 'invalid_arguments', message: 'Usage: /resume <session_id>' };
    }
    const targetId = args[0]!;
    const session = this.sessions.get(targetId);
    if (!session) {
      return { kind: 'session_not_found', message: `Session not found: ${targetId}` };
    }

    const scope: DeepAgentSessionScope = { kind: ctx.surface, key: ctx.sessionId };
    this.sessions.ensure(targetId, { scope });
    handler.resumeSession(scope, targetId);
    handler.resetLocalState();
    return {
      kind: 'ok',
      message: `Resumed session: "${session.title}" (${targetId})`,
      data: { sessionId: targetId },
    };
  }

  private async executeDelete(args: string[], ctx: SlashCommandContext, handler: SlashHandler): Promise<SlashCommandResult> {
    if (args.length === 0) {
      return { kind: 'invalid_arguments', message: 'Usage: /delete <session_id>' };
    }
    const targetId = args[0]!;
    const session = this.sessions.get(targetId);
    if (!session) {
      return { kind: 'session_not_found', message: `Session not found: ${targetId}` };
    }

    const scope: DeepAgentSessionScope = { kind: ctx.surface, key: ctx.sessionId };
    const activeSession = this.sessions.getActiveForScope(scope);
    const isActive = activeSession?.id === targetId;

    try {
      await this.sessions.delete(targetId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: 'error', message: `Failed to delete session: ${message}` };
    }

    if (isActive) {
      const fresh = this.sessions.rotateForScope(scope, { title: 'New conversation' });
      handler.resumeSession(scope, fresh.id);
      handler.resetLocalState();
    }

    return {
      kind: 'ok',
      message: `Session deleted: "${session.title}" (${targetId})${isActive ? '. Started new session.' : ''}`,
      data: { deletedId: targetId, newActiveId: isActive ? this.sessions.getActiveForScope(scope)?.id : undefined },
    };
  }

  private executeNew(ctx: SlashCommandContext, handler: SlashHandler): SlashCommandResult {
    const scope: DeepAgentSessionScope = { kind: ctx.surface, key: ctx.sessionId };
    const fresh = this.sessions.rotateForScope(scope, { title: 'New conversation' });
    handler.resumeSession(scope, fresh.id);
    handler.resetLocalState();
    return {
      kind: 'ok',
      message: `New session started: ${fresh.id}`,
      data: { sessionId: fresh.id },
    };
  }

  private buildCheckpointsResult(ctx: SlashCommandContext): SlashCommandResult {
    const checkpoints = this.sessions.listCheckpointsSync(ctx.threadId);
    if (checkpoints.length === 0) {
      return { kind: 'ok', message: 'No checkpoints saved for this session.', data: { checkpoints: [] } };
    }
    const entries: CheckpointListEntry[] = checkpoints.map((cp) => ({
      id: cp.id,
      sessionId: cp.sessionId,
      createdAt: cp.createdAt,
      messageCount: cp.messageCount,
      summary: cp.summary,
      reason: cp.reason,
      label: cp.label,
      restoredAt: cp.restoredAt,
    }));
    const lines = checkpoints.map((cp: CheckpointMetadata, i: number) => {
      const label = cp.label ? ` "${cp.label}"` : '';
      const reason = cp.reason ? ` [${cp.reason}]` : '';
      const restored = cp.restoredAt ? ` restored ${new Date(cp.restoredAt).toLocaleString()}` : '';
      return `${i + 1}. ${cp.id}${label}${reason} — ${new Date(cp.createdAt).toLocaleString()} — ${cp.messageCount} msgs${restored}`;
    });
    return {
      kind: 'ok',
      message: `Checkpoints:\n${lines.join('\n')}`,
      data: { checkpoints: entries },
    };
  }

  private async executeSaveCheckpoint(ctx: SlashCommandContext): Promise<SlashCommandResult> {
    try {
      const checkpoint = await this.sessions.saveCheckpoint(ctx.threadId, {
        reason: 'manual',
        payloads: { compaction: this.checkpointPayloads.getState(ctx.threadId) },
      });
      return {
        kind: 'ok',
        message: `Checkpoint saved: ${checkpoint.id}`,
        data: { checkpointId: checkpoint.id, checkpoint },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: 'error', message: `Failed to save checkpoint: ${message}` };
    }
  }

  private async executeRestore(args: string[], ctx: SlashCommandContext, handler: SlashHandler): Promise<SlashCommandResult> {
    if (args.length === 0) {
      return { kind: 'invalid_arguments', message: 'Usage: /restore <checkpoint_id>' };
    }
    const checkpointId = args[0]!;
    try {
      const result = await this.sessions.restoreCheckpoint(ctx.threadId, checkpointId);
      if ('compaction' in result.payloads) {
        this.checkpointPayloads.setState(ctx.threadId, result.payloads.compaction);
      } else {
        this.checkpointPayloads.reset(ctx.threadId);
      }
      return {
        kind: 'ok',
        message: `Checkpoint ${checkpointId} restored. Resume your conversation.`,
        data: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: 'checkpoint_not_found', message: `Failed to restore checkpoint: ${message}` };
    }
  }

  private async executeDeleteCheckpoint(args: string[], ctx: SlashCommandContext): Promise<SlashCommandResult> {
    if (args.length === 0) {
      return { kind: 'invalid_arguments', message: 'Usage: /checkpoint_delete <checkpoint_id>' };
    }
    const checkpointId = args[0]!;
    try {
      await this.sessions.deleteCheckpoint(ctx.threadId, checkpointId);
      return { kind: 'ok', message: `Checkpoint deleted: ${checkpointId}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: 'error', message: `Failed to delete checkpoint: ${message}` };
    }
  }
}

function parseImpactArgs(args: string[], sessionId: string): ImpactLedgerQuery {
  const query: ImpactLedgerQuery = { sessionId, limit: 12 };
  for (const arg of args) {
    const normalized = arg.toLowerCase();
    if (normalized === 'all') {
      delete query.limit;
      continue;
    }
    const maybeLimit = Number.parseInt(normalized, 10);
    if (Number.isInteger(maybeLimit) && maybeLimit > 0) {
      query.limit = maybeLimit;
    }
  }
  return query;
}

export type { ParsedSlashInput, SlashCommandMeta, SlashSurface } from '@yagr/conversation-core';
