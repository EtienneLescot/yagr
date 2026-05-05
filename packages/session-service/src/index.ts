import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import {
  extractSessionMemory,
  FileSessionMemoryAdapter,
  type SessionMemoryAdapter,
  type SessionMessage,
} from '@yagr/session-memory';
import {
  buildDeepAgentSessionConfig,
  CheckpointManager,
  DeepAgentSessionStore,
  deriveSessionTitle,
  type CheckpointEvent,
  type CheckpointMetadata,
  type CheckpointPolicy,
  type CheckpointReason,
  type CheckpointSummary,
  type CreateDeepAgentSessionOptions,
  type DeepAgentSessionRecord,
  type DeepAgentSessionScope,
  type RestoreCheckpointOptions,
  type RestoreCheckpointResult,
  type SaveCheckpointOptions,
} from '@yagr/session-checkpoint';
import { WebUiSessionRegistry, type SessionSummary, type WebUiSession } from '@yagr/webui-session-registry';

export interface SessionServiceOptions {
  sessionsDir: string;
  webUiSessionsDir?: string;
  memoryAdapter?: SessionMemoryAdapter;
  memoriesDir?: string;
  checkpointPolicy?: Partial<CheckpointPolicy>;
}

type CheckpointEventListener = (event: CheckpointEvent) => void | Promise<void>;

const DEFAULT_CHECKPOINT_POLICY: CheckpointPolicy = {
  enabled: true,
  beforeToolCalls: false,
  afterFileModifications: true,
  beforeCompaction: false,
  afterCompaction: false,
};

export class SessionService {
  private readonly store: DeepAgentSessionStore;
  private readonly webUiRegistry?: WebUiSessionRegistry;
  private readonly memoryAdapter?: SessionMemoryAdapter;
  private checkpointer?: BaseCheckpointSaver;
  private checkpointManager?: CheckpointManager;
  private pendingCheckpointInitializer?: () => Promise<BaseCheckpointSaver>;
  private checkpointPolicy: CheckpointPolicy;
  private readonly checkpointListeners = new Set<CheckpointEventListener>();

  constructor(options: SessionServiceOptions) {
    this.store = new DeepAgentSessionStore(options.sessionsDir);
    this.webUiRegistry = options.webUiSessionsDir ? new WebUiSessionRegistry(options.webUiSessionsDir) : undefined;
    this.memoryAdapter = options.memoryAdapter ?? (options.memoriesDir ? new FileSessionMemoryAdapter(options.memoriesDir) : undefined);
    this.checkpointPolicy = { ...DEFAULT_CHECKPOINT_POLICY, ...options.checkpointPolicy };
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

  onCheckpoint(listener: CheckpointEventListener): () => void {
    this.checkpointListeners.add(listener);
    return () => this.checkpointListeners.delete(listener);
  }

  getCheckpointPolicy(): CheckpointPolicy {
    return { ...this.checkpointPolicy };
  }

  setCheckpointPolicy(policy: Partial<CheckpointPolicy>): CheckpointPolicy {
    this.checkpointPolicy = { ...this.checkpointPolicy, ...policy };
    return this.getCheckpointPolicy();
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
    this.memoryAdapter?.delete(id);
    if (this.checkpointer) {
      await this.store.deleteThread(this.checkpointer, id);
    }
  }

  buildSessionConfig(sessionId: string) {
    return buildDeepAgentSessionConfig(sessionId);
  }

  listCheckpointsSync(sessionId: string): CheckpointSummary[] {
    return this.checkpointManager?.listCheckpointsSync(sessionId) ?? [];
  }

  async listCheckpoints(sessionId: string): Promise<CheckpointSummary[]> {
    return this.listCheckpointsSync(sessionId);
  }

  async saveCheckpoint(sessionId: string, options: SaveCheckpointOptions = {}): Promise<CheckpointSummary> {
    if (!this.checkpointManager) {
      await this.ensureCheckpointAccess();
    }
    try {
      const checkpoint = await this.checkpointManager!.saveCheckpoint(sessionId, {
        ...options,
        session: options.session ?? this.toSessionSnapshot(this.store.get(sessionId)),
        maxCheckpointsPerSession: options.maxCheckpointsPerSession ?? this.checkpointPolicy.maxCheckpointsPerSession,
      });
      this.emitCheckpoint({
        type: 'saved',
        sessionId,
        checkpointId: checkpoint.id,
        reason: checkpoint.reason,
        summary: checkpoint.summary,
      });
      return checkpoint;
    } catch (error) {
      this.emitCheckpoint({ type: 'failed', sessionId, reason: options.reason, summary: options.summary, error });
      throw error;
    }
  }

  async maybeSaveCheckpoint(
    sessionId: string,
    reason: CheckpointReason,
    options: Omit<SaveCheckpointOptions, 'reason'> = {},
  ): Promise<CheckpointSummary | undefined> {
    if (!this.shouldSaveForReason(reason)) {
      return undefined;
    }
    return this.saveCheckpoint(sessionId, { ...options, reason });
  }

  async restoreCheckpoint(
    sessionId: string,
    checkpointId: string,
    options: RestoreCheckpointOptions = {},
  ): Promise<RestoreCheckpointResult> {
    if (!this.checkpointManager) {
      await this.ensureCheckpointAccess();
    }
    try {
      const result = await this.checkpointManager!.restoreCheckpoint(sessionId, checkpointId);
      const warnings = [...(result.warnings ?? [])];
      if (options.restoreSessionMetadata !== false && result.session) {
        this.store.replace({ ...result.session, updatedAt: result.restoredAt });
        this.webUiRegistry?.setTitle(sessionId, result.session.title);
      } else if (options.restoreSessionMetadata !== false) {
        warnings.push('No session metadata snapshot was saved for this checkpoint.');
      }

      const finalResult: RestoreCheckpointResult = {
        ...result,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
      this.emitCheckpoint({ type: 'restored', sessionId, checkpointId });
      return finalResult;
    } catch (error) {
      this.emitCheckpoint({ type: 'failed', sessionId, checkpointId, error });
      throw error;
    }
  }

  async deleteCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
    if (!this.checkpointManager) {
      await this.ensureCheckpointAccess();
    }
    try {
      await this.checkpointManager!.deleteCheckpoint(sessionId, checkpointId);
      this.emitCheckpoint({ type: 'deleted', sessionId, checkpointId });
    } catch (error) {
      this.emitCheckpoint({ type: 'failed', sessionId, checkpointId, error });
      throw error;
    }
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

  persistMemory(sessionId: string, title: string, createdAt: string, messages: readonly SessionMessage[] = []): void {
    if (!this.memoryAdapter) {
      return;
    }
    try {
      this.memoryAdapter.persist(extractSessionMemory(sessionId, title, createdAt, messages));
    } catch {
      // Best-effort only.
    }
  }

  private sessionsDir(): string {
    return this.store.getSessionsDir();
  }

  private shouldSaveForReason(reason: CheckpointReason): boolean {
    if (!this.checkpointPolicy.enabled) {
      return false;
    }
    switch (reason) {
      case 'manual':
      case 'auto':
        return true;
      case 'before-tool':
        return Boolean(this.checkpointPolicy.beforeToolCalls);
      case 'after-tool':
        return Boolean(this.checkpointPolicy.afterFileModifications);
      case 'before-compaction':
        return Boolean(this.checkpointPolicy.beforeCompaction);
      case 'after-compaction':
        return Boolean(this.checkpointPolicy.afterCompaction);
    }
    return false;
  }

  private toSessionSnapshot(record: DeepAgentSessionRecord | undefined) {
    if (!record) {
      return undefined;
    }
    return {
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      title: record.title,
      ...(record.closedAt ? { closedAt: record.closedAt } : {}),
      ...(record.scope ? { scope: record.scope } : {}),
    };
  }

  private emitCheckpoint(event: CheckpointEvent): void {
    for (const listener of this.checkpointListeners) {
      try {
        void Promise.resolve(listener(event)).catch(() => {
          // Checkpoint lifecycle must not depend on observer success.
        });
      } catch {
        // Checkpoint lifecycle must not depend on observer success.
      }
    }
  }
}

export {
  deriveSessionTitle,
  type CheckpointEvent,
  type CheckpointEventListener,
  type CreateDeepAgentSessionOptions,
  type CheckpointMetadata,
  type CheckpointPolicy,
  type CheckpointReason,
  type CheckpointSummary,
  type DeepAgentSessionRecord,
  type DeepAgentSessionScope,
  type RestoreCheckpointOptions,
  type RestoreCheckpointResult,
  type SaveCheckpointOptions,
  type SessionMessage,
  type SessionMemoryAdapter,
  type SessionSummary,
  type WebUiSession,
};
