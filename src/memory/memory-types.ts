/**
 * A compact record of what happened in one session.
 * Stored in ~/.yagr/memories/<sessionId>.json.
 * Injected into the system prompt of future sessions so the agent has
 * cross-session continuity without replaying entire conversation histories.
 */
export interface SessionMemoryRecord {
  sessionId: string;
  /** Human-readable title derived from the first user message. */
  title: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601 — updated after each run in the session
  /**
   * Compact prose summary of the work done.
   * Extracted rule-based from the message history; no LLM call required.
   */
  summary: string;
  /**
   * Names of meaningful tools used (excludes pure-commentary tools like
   * reportProgress and presentWorkflowResult so the signal stays clear).
   */
  toolsUsed: string[];
  /**
   * Workflow IDs touched during the session (from presentWorkflowResult calls).
   * Helps the agent recognize existing workflows across sessions.
   */
  workflowRefs: WorkflowRef[];
}

export interface WorkflowRef {
  id: string;
  title: string;
}
