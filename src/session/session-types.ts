/**
 * A serialized LLM message stored on disk (role + content, JSON-safe).
 * Mirrors the shape of Vercel AI SDK CoreMessage without the runtime dependency.
 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | unknown[];
}

export type {
  CheckpointMetadata,
  DeepAgentSessionRecord,
  DeepAgentSessionScope,
  SessionSummary,
} from '@yagr/session-service';

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
