/**
 * A serialized LLM message stored on disk (role + content, JSON-safe).
 * Mirrors the shape of Vercel AI SDK CoreMessage without the runtime dependency.
 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | unknown[];
}

/**
 * Generic low-level session scope used to bind a Deepagents thread to an
 * external conversation identity without coupling the store to a specific
 * facade implementation.
 */
export interface DeepAgentSessionScope {
  kind: string;
  key: string;
}

/**
 * Persisted metadata for one Deepagents thread.
 * The authoritative runtime state still lives in the LangGraph checkpointer.
 */
export interface DeepAgentSessionRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  scope?: DeepAgentSessionScope;
  closedAt?: string;
}

/**
 * A rich UI message that can be saved alongside the CoreMessages so that
 * the WebUI can restore the full visual state (progress tickers, etc.)
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
}

/**
 * Lightweight summary returned by the list endpoint — omits messages and
 * displayMessages to keep the payload small.
 */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * Metadata for a named checkpoint of a session.
 * Checkpoints capture the full agent state at a point in time and can be
 * restored to resume conversation from that exact state.
 */
export interface CheckpointMetadata {
  id: string;
  sessionId: string;
  createdAt: string;
  messageCount: number;
  summary?: string;
}
