import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import {
  buildDeepAgentSessionConfig,
  CheckpointManager,
  DeepAgentSessionStore,
  deriveSessionTitle,
  type CheckpointMetadata,
  type CreateDeepAgentSessionOptions,
  type DeepAgentSessionRecord,
  type DeepAgentSessionScope,
} from '@yagr/session-checkpoint';
import { WebUiSessionRegistry, type SessionSummary, type WebUiSession } from '@yagr/webui-session-registry';

export interface SessionServiceOptions {
  sessionsDir: string;
  webUiSessionsDir?: string;
}

export interface RestoreResult {
  checkpointId: string;
  sessionId: string;
  payloadState: unknown | null;
  restoredAt: string;
}

export interface SaveCheckpointOptions {
  payloadState?: unknown | null;
}

export class SessionService {
  private readonly store: DeepAgentSessionStore;
  private readonly webUiRegistry?: WebUiSessionRegistry;
  private checkpointer?: BaseCheckpointSaver;
  private checkpointManager?: CheckpointManager;
  private pendingCheckpointInitializer?: () => Promise<BaseCheckpointSaver>;

  constructor(options: SessionServiceOptions) {
    this.store = new DeepAgentSessionStore(options.sessionsDir);
    this.webUiRegistry = options.webUiSessionsDir ? new WebUiSessionRegistry(options.webUiSessionsDir) : undefined;
  }

  setCheckpointer(checkpointer: BaseCheckpointSaver): void {
    this.checkpointer = checkpointer;
    this.checkpointManager = new CheckpointManager(checkpointer, this.sessionsDir());
  }

  registerCheckpointInitializer(initializer: () => Promise<BaseCheckpointSaver>): void {
    this.pendingCheckpointInitializer = initializer;
  }

  async ensureCheckpointAccess(): Promise<void> {
    if (this.checkpointManager) {
      return;
    }
    if (this.pendingCheckpointInitializer) {
      this.setCheckpointer(await this.pendingCheckpointInitializer());
      return;
    }
    throw new Error('Checkpoint access not available. Call setCheckpointer() or register a checkpoint initializer first.');
  }

  list(): SessionSummary[] {
    if (this.webUiRegistry) {
      return this.webUiRegistry.list();
    }
    return this.store.list().map((record: DeepAgentSessionRecord) => ({
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      messageCount: 0,
    }));
  }

  get(id: string): DeepAgentSessionRecord | undefined {
    return this.store.get(id);
  }

  create(options: CreateDeepAgentSessionOptions = {}): DeepAgentSessionRecord {
    const record = this.store.create(options);
    this.webUiRegistry?.createEmpty(record.id);
    this.webUiRegistry?.setTitle(record.id, record.title);
    return record;
  }

  ensure(sessionId: string, options: Omit<CreateDeepAgentSessionOptions, 'id'> = {}): DeepAgentSessionRecord {
    const record = this.store.ensure(sessionId, options);
    if (this.webUiRegistry && !this.webUiRegistry.get(record.id)) {
      this.webUiRegistry.createEmpty(record.id);
    }
    this.webUiRegistry?.setTitle(record.id, record.title);
    return record;
  }

  touch(sessionId: string, options?: { title?: string; closed?: boolean }): DeepAgentSessionRecord | undefined {
    const record = this.store.touch(sessionId, options);
    if (record) {
      this.webUiRegistry?.setTitle(record.id, record.title);
    }
    return record;
  }

  getOrCreateForScope(scope: DeepAgentSessionScope, options?: { title?: string }): DeepAgentSessionRecord {
    const record = this.store.getOrCreateActiveForScope(scope, { title: options?.title });
    if (this.webUiRegistry && !this.webUiRegistry.get(record.id)) {
      this.webUiRegistry.createEmpty(record.id);
    }
    this.webUiRegistry?.setTitle(record.id, record.title);
    return record;
  }

  rotateForScope(scope: DeepAgentSessionScope, options?: { title?: string }): DeepAgentSessionRecord {
    const record = this.store.rotateActiveForScope(scope, { title: options?.title });
    if (this.webUiRegistry && !this.webUiRegistry.get(record.id)) {
      this.webUiRegistry.createEmpty(record.id);
    }
    this.webUiRegistry?.setTitle(record.id, record.title);
    return record;
  }

  clearScope(scope: DeepAgentSessionScope): void {
    this.store.clearActiveScope(scope);
  }

  getActiveForScope(scope: DeepAgentSessionScope): DeepAgentSessionRecord | undefined {
    return this.store.getActiveForScope(scope);
  }

  listForScope(scope: DeepAgentSessionScope): DeepAgentSessionRecord[] {
    return this.store.list().filter((record) => record.scope?.kind === scope.kind && record.scope?.key === scope.key);
  }

  async delete(id: string): Promise<void> {
    if (this.checkpointManager) {
      await this.checkpointManager.deleteAllCheckpoints(id);
    }
    this.store.delete(id);
    this.webUiRegistry?.delete(id);
    if (this.checkpointer) {
      await this.store.deleteThread(this.checkpointer, id);
    }
  }

  buildSessionConfig(sessionId: string) {
    return buildDeepAgentSessionConfig(sessionId);
  }

  listCheckpointsSync(sessionId: string): CheckpointMetadata[] {
    return this.checkpointManager?.listCheckpointsSync(sessionId) ?? [];
  }

  async listCheckpoints(sessionId: string): Promise<CheckpointMetadata[]> {
    return this.listCheckpointsSync(sessionId);
  }

  async saveCheckpoint(sessionId: string, options: SaveCheckpointOptions = {}): Promise<CheckpointMetadata> {
    if (!this.checkpointManager) {
      await this.ensureCheckpointAccess();
    }
    return this.checkpointManager!.saveCheckpoint(sessionId, options.payloadState);
  }

  async restoreCheckpoint(sessionId: string, checkpointId: string): Promise<RestoreResult> {
    if (!this.checkpointManager) {
      await this.ensureCheckpointAccess();
    }
    const payloadState = await this.checkpointManager!.restoreCheckpoint(sessionId, checkpointId);
    return {
      checkpointId,
      sessionId,
      payloadState,
      restoredAt: new Date().toISOString(),
    };
  }

  async deleteCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
    if (!this.checkpointManager) {
      await this.ensureCheckpointAccess();
    }
    await this.checkpointManager!.deleteCheckpoint(sessionId, checkpointId);
  }

  syncDisplayThread(sessionId: string, displayThread: unknown[]): void {
    this.webUiRegistry?.setDisplayThread(sessionId, displayThread);
  }

  clearDisplayThread(sessionId: string): void {
    this.webUiRegistry?.clearDisplayThread(sessionId);
  }

  setTitle(sessionId: string, title: string): void {
    this.webUiRegistry?.setTitle(sessionId, title);
  }

  readDisplaySession(sessionId: string): WebUiSession | undefined {
    return this.webUiRegistry?.get(sessionId);
  }

  persistMemory(_sessionId: string, _title: string, _createdAt: string): void {
    // Optional higher-level memory persistence can be layered on later.
  }

  private sessionsDir(): string {
    return this.store.getSessionsDir();
  }
}

export {
  deriveSessionTitle,
  type CreateDeepAgentSessionOptions,
  type CheckpointMetadata,
  type DeepAgentSessionRecord,
  type DeepAgentSessionScope,
  type SessionSummary,
  type WebUiSession,
};
