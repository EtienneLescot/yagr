export interface DeepAgentSessionScope {
  kind: string;
  key: string;
}

export interface DeepAgentSessionRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  closedAt?: string;
  scope?: DeepAgentSessionScope;
}

export interface CheckpointMetadata {
  id: string;
  sessionId: string;
  createdAt: string;
  messageCount: number;
  summary?: string;
}
