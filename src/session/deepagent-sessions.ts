import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'path';
import type { RunnableConfig } from '@langchain/core/runnables';
import type {
  BaseCheckpointSaver,
  ChannelVersions,
  CheckpointMetadata as LangGraphCheckpointMetadata,
  CheckpointPendingWrite,
  CheckpointTuple,
  PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { CheckpointMetadata, DeepAgentSessionRecord, DeepAgentSessionScope } from './session-types.js';

interface SessionScopeState {
  activeByScopeKey?: Record<string, string>;
}

export interface CreateDeepAgentSessionOptions {
  id?: string;
  title?: string;
  scope?: DeepAgentSessionScope;
}

export interface TouchDeepAgentSessionOptions {
  title?: string;
  closed?: boolean;
}

export function buildDeepAgentSessionConfig(sessionId: string): {
  configurable: { thread_id: string };
  version: 'v2';
} {
  return {
    configurable: { thread_id: sessionId },
    version: 'v2',
  };
}

export function deriveSessionTitle(text: string, fallback = 'New conversation'): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.length <= 80
    ? normalized
    : `${normalized.slice(0, 77).trimEnd()}...`;
}

export class DeepAgentSessionStore {
  constructor(private readonly sessionsDir: string) {}

  list(): DeepAgentSessionRecord[] {
    this.ensureDir();

    const files = fs
      .readdirSync(this.sessionsDir)
      .filter((file) => file.endsWith('.json') && !file.startsWith('.'));

    const results: DeepAgentSessionRecord[] = [];
    for (const file of files) {
      const record = this.readRecord(path.join(this.sessionsDir, file));
      if (record) {
        results.push(record);
      }
    }

    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(sessionId: string): DeepAgentSessionRecord | undefined {
    return this.readRecord(this.recordPath(sessionId));
  }

  create(options: CreateDeepAgentSessionOptions = {}): DeepAgentSessionRecord {
    const now = new Date().toISOString();
    const record: DeepAgentSessionRecord = {
      id: options.id ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
      title: options.title?.trim() || 'New conversation',
      ...(options.scope ? { scope: options.scope } : {}),
    };

    this.save(record);
    if (record.scope) {
      this.setActiveScope(record.scope, record.id);
    }

    return record;
  }

  ensure(sessionId: string, options: Omit<CreateDeepAgentSessionOptions, 'id'> = {}): DeepAgentSessionRecord {
    const existing = this.get(sessionId);
    if (existing) {
      let next = existing;
      if (options.scope && this.scopeChanged(existing.scope, options.scope)) {
        next = { ...next, scope: options.scope, updatedAt: new Date().toISOString() };
      }
      if (options.title && existing.title === 'New conversation') {
        next = { ...next, title: options.title.trim() || existing.title, updatedAt: new Date().toISOString() };
      }
      if (next !== existing) {
        this.save(next);
      }
      if (next.scope) {
        this.setActiveScope(next.scope, next.id);
      }
      return next;
    }

    return this.create({ id: sessionId, ...options });
  }

  touch(sessionId: string, options: TouchDeepAgentSessionOptions = {}): DeepAgentSessionRecord | undefined {
    const existing = this.get(sessionId);
    if (!existing) {
      return undefined;
    }

    const next: DeepAgentSessionRecord = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };

    if (options.title?.trim()) {
      next.title = options.title.trim();
    }

    if (options.closed) {
      next.closedAt = next.updatedAt;
    }

    this.save(next);
    return next;
  }

  getActiveForScope(scope: DeepAgentSessionScope): DeepAgentSessionRecord | undefined {
    const sessionId = this.readScopeState().activeByScopeKey?.[this.scopeKey(scope)];
    return sessionId ? this.get(sessionId) : undefined;
  }

  getOrCreateActiveForScope(scope: DeepAgentSessionScope, options: Omit<CreateDeepAgentSessionOptions, 'id' | 'scope'> = {}): DeepAgentSessionRecord {
    const existing = this.getActiveForScope(scope);
    if (existing) {
      return existing;
    }

    return this.create({
      title: options.title,
      scope,
    });
  }

  rotateActiveForScope(scope: DeepAgentSessionScope, options: Omit<CreateDeepAgentSessionOptions, 'id' | 'scope'> = {}): DeepAgentSessionRecord {
    const previous = this.getActiveForScope(scope);
    if (previous) {
      this.touch(previous.id, { closed: true });
    }

    return this.create({
      title: options.title,
      scope,
    });
  }

  clearActiveScope(scope: DeepAgentSessionScope): void {
    const state = this.readScopeState();
    const key = this.scopeKey(scope);
    if (!state.activeByScopeKey?.[key]) {
      return;
    }

    const next = { ...(state.activeByScopeKey ?? {}) };
    delete next[key];
    this.writeScopeState({ activeByScopeKey: next });
  }

  delete(sessionId: string): void {
    const filePath = this.recordPath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const state = this.readScopeState();
    const nextEntries = Object.entries(state.activeByScopeKey ?? {})
      .filter(([, value]) => value !== sessionId);
    this.writeScopeState({ activeByScopeKey: Object.fromEntries(nextEntries) });
  }

  async deleteThread(checkpointer: BaseCheckpointSaver, sessionId: string): Promise<void> {
    await checkpointer.deleteThread(sessionId);
  }

  private save(record: DeepAgentSessionRecord): void {
    this.ensureDir();
    fs.writeFileSync(this.recordPath(record.id), JSON.stringify(record, null, 2), 'utf-8');
  }

  private recordPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  private scopeStatePath(): string {
    return path.join(this.sessionsDir, '.scopes.json');
  }

  private setActiveScope(scope: DeepAgentSessionScope, sessionId: string): void {
    const state = this.readScopeState();
    this.writeScopeState({
      activeByScopeKey: {
        ...(state.activeByScopeKey ?? {}),
        [this.scopeKey(scope)]: sessionId,
      },
    });
  }

  private scopeKey(scope: DeepAgentSessionScope): string {
    return `${scope.kind}:${scope.key}`;
  }

  private scopeChanged(left?: DeepAgentSessionScope, right?: DeepAgentSessionScope): boolean {
    return left?.kind !== right?.kind || left?.key !== right?.key;
  }

  private readScopeState(): SessionScopeState {
    const filePath = this.scopeStatePath();
    if (!fs.existsSync(filePath)) {
      return {};
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionScopeState;
    } catch {
      return {};
    }
  }

  private writeScopeState(state: SessionScopeState): void {
    this.ensureDir();
    fs.writeFileSync(this.scopeStatePath(), JSON.stringify(state, null, 2), 'utf-8');
  }

  private readRecord(filePath: string): DeepAgentSessionRecord | undefined {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DeepAgentSessionRecord;
    } catch {
      return undefined;
    }
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }
}

export class CheckpointManager {
  constructor(
    private readonly checkpointer: BaseCheckpointSaver,
    private readonly sessionsDir: string,
  ) {}

  private checkpointDir(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId, 'checkpoints');
  }

  private checkpointPath(sessionId: string, checkpointId: string): string {
    return path.join(this.checkpointDir(sessionId), checkpointId);
  }

  async listCheckpoints(sessionId: string): Promise<CheckpointMetadata[]> {
    const dir = this.checkpointDir(sessionId);
    if (!fs.existsSync(dir)) {
      return [];
    }

    const checkpoints: CheckpointMetadata[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(dir, entry.name, 'metadata.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CheckpointMetadata;
        checkpoints.push(meta);
      } catch {
        // Skip invalid checkpoint metadata
      }
    }

    return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getCheckpoint(sessionId: string, checkpointId: string): Promise<{ tuple: CheckpointTuple; metadata: CheckpointMetadata } | undefined> {
    const cpPath = this.checkpointPath(sessionId, checkpointId);
    const checkpointFile = path.join(cpPath, 'checkpoint.json');
    const metadataFile = path.join(cpPath, 'metadata.json');

    if (!fs.existsSync(checkpointFile) || !fs.existsSync(metadataFile)) {
      return undefined;
    }

    try {
      const [tuple, metadata] = await Promise.all([
        Promise.resolve(JSON.parse(fs.readFileSync(checkpointFile, 'utf-8')) as CheckpointTuple),
        Promise.resolve(JSON.parse(fs.readFileSync(metadataFile, 'utf-8')) as CheckpointMetadata),
      ]);
      return { tuple, metadata };
    } catch {
      return undefined;
    }
  }

  async saveCheckpoint(sessionId: string): Promise<CheckpointMetadata> {
    const checkpointTuple = await this.checkpointer.getTuple({ configurable: { thread_id: sessionId } });
    if (!checkpointTuple) {
      throw new Error(`No checkpoint found for session ${sessionId}`);
    }

    const checkpointId = randomUUID();
    const now = new Date().toISOString();
    const cpPath = this.checkpointPath(sessionId, checkpointId);

    fs.mkdirSync(cpPath, { recursive: true });

    const metadata: CheckpointMetadata = {
      id: checkpointId,
      sessionId,
      createdAt: now,
      messageCount: this.countMessages(checkpointTuple.checkpoint),
    };

    fs.writeFileSync(
      path.join(cpPath, 'checkpoint.json'),
      JSON.stringify(checkpointTuple),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(cpPath, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8',
    );

    return metadata;
  }

  private countMessages(channelData: unknown): number {
    if (!channelData || typeof channelData !== 'object') return 0;
    const data = channelData as Record<string, unknown>;
    const channelValues = data.channel_values;
    if (channelValues && typeof channelValues === 'object') {
      const values = channelValues as Record<string, unknown>;
      if (Array.isArray(values.messages)) {
        return values.messages.length;
      }
      if (Array.isArray(values.channel_messages)) {
        return values.channel_messages.length;
      }
    }
    if (Array.isArray(data.messages)) {
      return data.messages.length;
    }
    if (Array.isArray(data.channel_messages)) {
      return data.channel_messages.length;
    }
    return 0;
  }

  async restoreCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
    const found = await this.getCheckpoint(sessionId, checkpointId);
    if (!found) {
      throw new Error(`Checkpoint ${checkpointId} not found for session ${sessionId}`);
    }

    const checkpointNamespace = found.tuple.config.configurable?.checkpoint_ns;
    const restoredConfig = await this.checkpointer.put(
      this.buildRestoreConfig(sessionId, checkpointNamespace),
      found.tuple.checkpoint,
      found.tuple.metadata ?? this.buildFallbackLangGraphMetadata(),
      {} as ChannelVersions,
    );

    await Promise.all(
      this.groupPendingWritesByTask(found.tuple.pendingWrites).map(([taskId, writes]) => this.checkpointer.putWrites(restoredConfig, writes, taskId)),
    );
  }

  async deleteCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
    const cpPath = this.checkpointPath(sessionId, checkpointId);
    if (fs.existsSync(cpPath)) {
      fs.rmSync(cpPath, { recursive: true, force: true });
    }
  }

  async deleteAllCheckpoints(sessionId: string): Promise<void> {
    const dir = this.checkpointDir(sessionId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private buildRestoreConfig(sessionId: string, checkpointNamespace?: string): RunnableConfig {
    return {
      configurable: {
        thread_id: sessionId,
        ...(checkpointNamespace ? { checkpoint_ns: checkpointNamespace } : {}),
      },
    };
  }

  private buildFallbackLangGraphMetadata(): LangGraphCheckpointMetadata {
    return {
      source: 'fork',
      step: -1,
      parents: {},
    };
  }

  private groupPendingWritesByTask(pendingWrites: CheckpointPendingWrite[] | undefined): Array<[string, PendingWrite[]]> {
    if (!pendingWrites?.length) {
      return [];
    }

    const writesByTask = new Map<string, PendingWrite[]>();
    for (const [taskId, channel, value] of pendingWrites) {
      const existing = writesByTask.get(taskId) ?? [];
      existing.push([channel, value]);
      writesByTask.set(taskId, existing);
    }

    return [...writesByTask.entries()];
  }
}
