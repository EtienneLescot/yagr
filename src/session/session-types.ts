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
    executionResult?: {
      status: 'success' | 'error' | 'waiting';
      executionId?: string;
      summary?: string;
      data?: string;
    };
  };
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
