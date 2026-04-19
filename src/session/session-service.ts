/**
 * Unified session management service — SSOT for conversation sessions.
 *
 * Provides a single authoritative interface for session lifecycle across all
 * façades (WebUI, Telegram, TUI, CLI). Wraps DeepAgentSessionStore for
 * thread metadata and MemoryStore for cross-session memory.
 *
 * Thread checkpoint deletion requires the checkpointer to be set via
 * `setCheckpointer()` before `deleteSession()` can fully clean up.
 */
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CheckpointManager, DeepAgentSessionStore, deriveSessionTitle, type CreateDeepAgentSessionOptions, type TouchDeepAgentSessionOptions } from './deepagent-sessions.js';
import { MemoryStore } from '../memory/memory-store.js';
import { extractSessionMemory } from '../memory/extract-session-memory.js';
import type {
  CheckpointMetadata,
  DeepAgentSessionRecord,
  DeepAgentSessionScope,
  SessionSummary,
} from './session-types.js';

export { deriveSessionTitle, type CreateDeepAgentSessionOptions } from './deepagent-sessions.js';

export interface SessionServiceOptions {
  sessionsDir: string;
  memoriesDir: string;
}

export class SessionService {
  private readonly store: DeepAgentSessionStore;
  private readonly memoryStore: MemoryStore;
  private readonly sessionsDir: string;
  private checkpointer?: BaseCheckpointSaver;
  private checkpointManager?: CheckpointManager;

  constructor(options: SessionServiceOptions) {
    this.sessionsDir = options.sessionsDir;
    this.store = new DeepAgentSessionStore(options.sessionsDir);
    this.memoryStore = new MemoryStore(options.memoriesDir);
  }

  setCheckpointer(checkpointer: BaseCheckpointSaver): void {
    this.checkpointer = checkpointer;
    this.checkpointManager = new CheckpointManager(checkpointer, this.sessionsDir);
  }

  list(): SessionSummary[] {
    const records = this.store.list();
    return records.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      messageCount: 0,
    }));
  }

  get(id: string): DeepAgentSessionRecord | undefined {
    return this.store.get(id);
  }

  create(options: CreateDeepAgentSessionOptions = {}): DeepAgentSessionRecord {
    return this.store.create(options);
  }

  ensure(sessionId: string, options: Omit<CreateDeepAgentSessionOptions, 'id'> = {}): DeepAgentSessionRecord {
    return this.store.ensure(sessionId, options);
  }

  resume(id: string): DeepAgentSessionRecord | undefined {
    return this.store.get(id);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
    this.memoryStore.delete(id);
    if (this.checkpointer) {
      await this.store.deleteThread(this.checkpointer, id);
    }
  }

  touch(id: string, options?: TouchDeepAgentSessionOptions): DeepAgentSessionRecord | undefined {
    return this.store.touch(id, options);
  }

  getOrCreateForScope(scope: DeepAgentSessionScope, options?: { title?: string }): DeepAgentSessionRecord {
    return this.store.getOrCreateActiveForScope(scope, { title: options?.title });
  }

  rotateForScope(scope: DeepAgentSessionScope, options?: { title?: string }): DeepAgentSessionRecord {
    return this.store.rotateActiveForScope(scope, { title: options?.title });
  }

  clearScope(scope: DeepAgentSessionScope): void {
    this.store.clearActiveScope(scope);
  }

  listForScope(scope: DeepAgentSessionScope): DeepAgentSessionRecord[] {
    const all = this.store.list();
    return all.filter((r) => r.scope?.kind === scope.kind && r.scope?.key === scope.key);
  }

  persistMemory(sessionId: string, title: string, createdAt: string): void {
    try {
      const memory = extractSessionMemory(sessionId, title, createdAt, []);
      this.memoryStore.save(memory);
    } catch {
      // Best-effort — never block.
    }
  }

  buildSessionConfig(sessionId: string): { configurable: { thread_id: string }; version: 'v2' } {
    return {
      configurable: { thread_id: sessionId },
      version: 'v2' as const,
    };
  }

  async listCheckpoints(sessionId: string): Promise<CheckpointMetadata[]> {
    if (!this.checkpointManager) {
      return [];
    }
    return this.checkpointManager.listCheckpoints(sessionId);
  }

  async saveCheckpoint(sessionId: string): Promise<CheckpointMetadata> {
    if (!this.checkpointManager) {
      throw new Error('Checkpoint manager not initialized. Call setCheckpointer first.');
    }
    return this.checkpointManager.saveCheckpoint(sessionId);
  }

  async restoreCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
    if (!this.checkpointManager) {
      throw new Error('Checkpoint manager not initialized. Call setCheckpointer first.');
    }
    return this.checkpointManager.restoreCheckpoint(sessionId, checkpointId);
  }

  async deleteCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
    if (!this.checkpointManager) {
      throw new Error('Checkpoint manager not initialized. Call setCheckpointer first.');
    }
    return this.checkpointManager.deleteCheckpoint(sessionId, checkpointId);
  }

  async deleteAllCheckpoints(sessionId: string): Promise<void> {
    if (!this.checkpointManager) {
      throw new Error('Checkpoint manager not initialized. Call setCheckpointer first.');
    }
    return this.checkpointManager.deleteAllCheckpoints(sessionId);
  }
}
