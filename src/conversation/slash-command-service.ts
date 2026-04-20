import type {
  ParsedSlashInput,
  SessionListEntry,
  CheckpointListEntry,
  SlashCommandContext,
  SlashCommandResult,
  SlashSurface,
} from './slash-command-types.js';
import { resolveCommand, getCommandsForSurface } from './slash-command-registry.js';
import type { CompactionService } from '../compaction/compaction-service.js';
import type { SessionService } from '../session/session-service.js';
import type { CheckpointMetadata, DeepAgentSessionScope } from '../session/session-types.js';

export interface SlashHandler {
  getActiveSessionId(scope: DeepAgentSessionScope): string | undefined;
  resumeSession(scope: DeepAgentSessionScope, sessionId: string): void;
  resetLocalState(): void;
  openExternalUrl?(url: string): Promise<void>;
  getDisplayOptions?(): { showThinking: boolean; showExecution: boolean };
  setDisplayOptions?(opts: { showThinking?: boolean; showExecution?: boolean }): void;
}

export class SlashCommandService {
  constructor(
    private readonly sessions: SessionService,
    private readonly compactionService: CompactionService,
  ) {}

  parse(raw: string): ParsedSlashInput | undefined {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('/')) {
      return undefined;
    }
    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0]!.toLowerCase();
    const command = resolveCommand(`/${name}`);
    if (!command) {
      return undefined;
    }
    return {
      command,
      args: parts.slice(1),
      raw,
    };
  }

  async execute(
    input: ParsedSlashInput,
    ctx: SlashCommandContext,
    handler: SlashHandler,
  ): Promise<SlashCommandResult> {
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
        return this.executeNew(ctx, handler);

      case 'reset':
        return this.executeNew(ctx, handler);

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
        return { kind: 'ok', message: 'Use the UI to approve pending actions.' };

      case 'compact':
        return { kind: 'ok', message: 'Compaction runs automatically when needed.' };

      case 'open': {
        return { kind: 'error', message: '/open requires a recent workflow. No workflow available.' };
      }

      case 'toggle_thinking': {
        if (handler.setDisplayOptions) {
          const current = handler.getDisplayOptions?.() ?? { showThinking: true };
          handler.setDisplayOptions({ showThinking: !current.showThinking });
          return { kind: 'ok', message: `Thinking display ${!current.showThinking ? 'hidden' : 'visible'}.` };
        }
        return { kind: 'unsupported_in_surface', message: '/toggle_thinking is not available in this surface.' };
      }

      case 'toggle_cli': {
        if (handler.setDisplayOptions) {
          const current = handler.getDisplayOptions?.() ?? { showExecution: true };
          handler.setDisplayOptions({ showExecution: !current.showExecution });
          return { kind: 'ok', message: `Command executions display ${!current.showExecution ? 'hidden' : 'visible'}.` };
        }
        return { kind: 'unsupported_in_surface', message: '/toggle_cli is not available in this surface.' };
      }

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

  private executeResume(
    args: string[],
    ctx: SlashCommandContext,
    handler: SlashHandler,
  ): SlashCommandResult {
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

  private executeDelete(
    args: string[],
    ctx: SlashCommandContext,
    handler: SlashHandler,
  ): SlashCommandResult {
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

    this.sessions.delete(targetId).catch(() => {});

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
    }));
    const lines = checkpoints.map(
      (cp: CheckpointMetadata, i: number) => `${i + 1}. ${cp.id} — ${new Date(cp.createdAt).toLocaleString()} — ${cp.messageCount} msgs`,
    );
    return {
      kind: 'ok',
      message: `Checkpoints:\n${lines.join('\n')}`,
      data: { checkpoints: entries },
    };
  }

  private async executeSaveCheckpoint(ctx: SlashCommandContext): Promise<SlashCommandResult> {
    try {
      const compactionState = this.compactionService.getState(ctx.threadId);
      const checkpoint = await this.sessions.saveCheckpoint(ctx.threadId, { compactionState });
      return {
        kind: 'ok',
        message: `Checkpoint saved: ${checkpoint.id}`,
        data: { checkpointId: checkpoint.id },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: 'error', message: `Failed to save checkpoint: ${message}` };
    }
  }

  private async executeRestore(
    args: string[],
    ctx: SlashCommandContext,
    handler: SlashHandler,
  ): Promise<SlashCommandResult> {
    if (args.length === 0) {
      return { kind: 'invalid_arguments', message: 'Usage: /restore <checkpoint_id>' };
    }
    const checkpointId = args[0]!;
    try {
      const result = await this.sessions.restoreCheckpoint(ctx.threadId, checkpointId);
      if (result.compactionState) {
        this.compactionService.setState(ctx.threadId, result.compactionState);
      } else {
        this.compactionService.reset(ctx.threadId);
      }
      handler.resetLocalState();
      return {
        kind: 'ok',
        message: `Checkpoint ${checkpointId} restored. Feed cleared. Resume your conversation.`,
        data: { checkpointId },
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
