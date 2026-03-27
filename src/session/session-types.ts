import type { CoreMessage } from 'ai';

export type SessionGateway = 'webui' | 'telegram' | 'tui';

/**
 * Serialized form of a display message — persisted alongside CoreMessage[]
 * so the exact conversation history can be restored in the UI without loss.
 * This is a subset of the frontend ChatMessage type without runtime-only fields
 * (id, streaming) that are re-generated on restore.
 */
export interface SerializedChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  finalState?: string;
  phase?: string;
  statusLabel?: string;
  progress?: Array<{
    tone: 'info' | 'success' | 'error';
    title: string;
    detail?: string;
  }>;
  embed?: {
    kind: string;
    workflowId?: string;
    url?: string;
    targetUrl?: string;
    title?: string;
    diagram?: string;
  };
}

/**
 * Full persisted session: stored as a single JSON file per session.
 * `messages` holds the complete Vercel AI SDK CoreMessage history (for agent context).
 * `displayMessages` holds the rich display log (for UI restoration).
 */
export interface PersistedSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  gateway: SessionGateway;
  /**
   * Gateway-scoped key that identifies the conversation endpoint.
   * - webui:    frontend-generated UUID (stored in localStorage)
   * - telegram: Telegram chatId (string)
   * - tui:      "default" (one active TUI session at a time)
   */
  gatewayKey: string;
  messages: CoreMessage[];
  /** Rich display messages for UI restoration. Populated by the WebUI facade. */
  displayMessages?: SerializedChatMessage[];
}

/**
 * Lightweight summary used for listing sessions without loading messages.
 */
export type SessionSummary = Omit<PersistedSession, 'messages' | 'displayMessages'> & {
  messageCount: number;
};
