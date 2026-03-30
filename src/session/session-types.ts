import type { CoreMessage } from 'ai';

/**
 * Which Yagr interface originated the session.
 */
export type SessionGateway = 'webui' | 'telegram' | 'tui';

/**
 * A rich UI message that can be saved alongside the CoreMessages so that
 * the WebUI can restore the full visual state (progress tickers, embeds, etc.)
 * without reconstructing it from raw LLM history.
 */
export interface SerializedChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  finalState?: string;
  phase?: string;
  statusLabel?: string;
  progress?: Array<{
    id: string;
    tone: 'info' | 'success' | 'error';
    title: string;
    detail?: string;
  }>;
  embed?: {
    kind: 'workflow';
    workflowId: string;
    url: string;
    targetUrl?: string;
    title?: string;
    diagram?: string;
  };
}

/**
 * Full session data written to disk.
 */
export interface PersistedSession {
  /** UUID generated when the session is first created. */
  id: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp, updated on every persist call. */
  updatedAt: string;
  /** Human-readable title derived from the first user message. */
  title: string;
  /** Which gateway created this session. */
  gateway: SessionGateway;
  /**
   * Gateway-specific key that identifies the conversation on that surface:
   * - webui:    frontend-generated UUID (stored in localStorage)
   * - telegram: Telegram chat ID
   * - tui:      fixed constant ("tui")
   */
  gatewayKey: string;
  /** LLM core messages — the authoritative conversation history. */
  messages: CoreMessage[];
  /**
   * Optional rich UI snapshot saved by the WebUI after every run.
   * When present, the WebUI uses this to restore the full visual state
   * instead of reconstructing it from raw CoreMessages.
   */
  displayMessages?: SerializedChatMessage[];
}

/**
 * Lightweight summary returned by the list endpoint — omits messages and
 * displayMessages to keep the payload small.
 */
export type SessionSummary = Omit<PersistedSession, 'messages' | 'displayMessages'> & {
  messageCount: number;
};
