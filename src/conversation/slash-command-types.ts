export type SlashSurface = 'tui' | 'webui' | 'telegram';

export const SLASH_SURFACES = ['tui', 'webui', 'telegram'] as const;

export type SlashCommandName =
  | 'help'
  | 'sessions'
  | 'resume'
  | 'delete'
  | 'new'
  | 'reset'
  | 'checkpoints'
  | 'save'
  | 'restore'
  | 'checkpoint_delete'
  | 'pending'
  | 'approve'
  | 'compact'
  | 'open'
  | 'toggle_thinking'
  | 'toggle_cli'
  | 'stop'
  | 'exit';

export interface SlashCommandMeta {
  name: SlashCommandName;
  description: string;
  usage: string;
  surfaces: SlashSurface[];
  aliases: string[];
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

export interface ParsedSlashInput {
  command: SlashCommandName;
  args: string[];
  raw: string;
}

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
}
