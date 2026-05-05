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

export type CheckpointReason =
  | 'manual'
  | 'auto'
  | 'before-tool'
  | 'after-tool'
  | 'before-compaction'
  | 'after-compaction';

export type CheckpointPayloads = Record<string, unknown>;

export interface CheckpointSummary {
  id: string;
  sessionId: string;
  createdAt: string;
  messageCount: number;
  summary?: string;
  reason?: CheckpointReason;
  label?: string;
  restoredAt?: string;
}

export type CheckpointMetadata = CheckpointSummary;

export interface CheckpointSessionSnapshot {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  closedAt?: string;
  scope?: DeepAgentSessionScope;
}

export interface SaveCheckpointOptions {
  summary?: string;
  reason?: CheckpointReason;
  label?: string;
  payloads?: CheckpointPayloads;
  session?: CheckpointSessionSnapshot;
  maxCheckpointsPerSession?: number;
}

export interface RestoreCheckpointOptions {
  restoreSessionMetadata?: boolean;
  restoreDisplayThread?: boolean;
}

export interface RestoreCheckpointResult {
  sessionId: string;
  checkpointId: string;
  restoredAt: string;
  langGraphRestored: boolean;
  pendingWritesRestored: boolean;
  payloads: CheckpointPayloads;
  payloadsRestored: string[];
  displayThreadRestored?: boolean;
  session?: CheckpointSessionSnapshot;
  warnings?: string[];
}

export interface CheckpointPolicy {
  enabled: boolean;
  beforeToolCalls?: boolean;
  afterFileModifications?: boolean;
  beforeCompaction?: boolean;
  afterCompaction?: boolean;
  maxCheckpointsPerSession?: number;
}

export interface CheckpointEvent {
  type: 'saved' | 'restored' | 'deleted' | 'failed';
  sessionId: string;
  checkpointId?: string;
  reason?: CheckpointReason;
  summary?: string;
  error?: unknown;
}
