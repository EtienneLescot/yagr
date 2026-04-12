import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { DeepAgentSessionRecord, DeepAgentSessionScope } from './session-types.js';

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
