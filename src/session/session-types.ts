import type { CoreMessage } from 'ai';

export type SessionGateway = 'webui' | 'telegram' | 'tui';

/**
 * Full persisted session: stored as a single JSON file per session.
 * `messages` holds the complete Vercel AI SDK CoreMessage history.
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
}

/**
 * Lightweight summary used for listing sessions without loading messages.
 */
export type SessionSummary = Omit<PersistedSession, 'messages'> & {
  messageCount: number;
};
