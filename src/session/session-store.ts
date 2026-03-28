import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CoreMessage } from 'ai';
import type { PersistedSession, SerializedChatMessage, SessionGateway, SessionSummary } from './session-types.js';

/**
 * Derive a human-readable title from the first user message in the history.
 */
export function deriveSessionTitle(messages: readonly CoreMessage[]): string {
  for (const msg of messages) {
    if (msg.role !== 'user') {
      continue;
    }

    const text =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join(' ')
          : '';

    const trimmed = text.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (trimmed) {
      return trimmed;
    }
  }

  return 'New conversation';
}

/**
 * SSOT file-based session store.
 *
 * One JSON file per session in `${YAGR_HOME}/sessions/`.
 * Active-session tracking lives in `.state.json` in the same directory.
 */
export class SessionStore {
  constructor(private readonly sessionsDir: string) {}

  // ---------------------------------------------------------------------------
  // Session CRUD
  // ---------------------------------------------------------------------------

  list(gateway?: SessionGateway): SessionSummary[] {
    this.ensureDir();

    const files = fs
      .readdirSync(this.sessionsDir)
      .filter((f) => f.endsWith('.json') && f !== '.state.json');

    const summaries: SessionSummary[] = [];

    for (const file of files) {
      const session = this.readFile(path.join(this.sessionsDir, file));
      if (session && (!gateway || session.gateway === gateway)) {
        summaries.push(this.toSummary(session));
      }
    }

    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(sessionId: string): PersistedSession | undefined {
    return this.readFile(this.sessionPath(sessionId));
  }

  /** Create an empty session on disk immediately (no messages yet). */
  createEmpty(gateway: SessionGateway, sessionId: string): void {
    const now = new Date().toISOString();
    this.save({
      id: sessionId,
      gateway,
      gatewayKey: sessionId,
      messages: [],
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
    });
  }

  save(session: PersistedSession): void {
    this.ensureDir();
    fs.writeFileSync(this.sessionPath(session.id), JSON.stringify(session, null, 2), 'utf-8');
  }

  delete(sessionId: string): void {
    const filePath = this.sessionPath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // ---------------------------------------------------------------------------
  // Display messages (WebUI rich UI snapshot)
  // ---------------------------------------------------------------------------

  setDisplayMessages(sessionId: string, displayMessages: SerializedChatMessage[]): void {
    const session = this.get(sessionId);
    if (!session) {
      return;
    }

    this.save({ ...session, displayMessages });
  }

  // ---------------------------------------------------------------------------
  // Persist a completed run
  // ---------------------------------------------------------------------------

  persistRun(sessionId: string, gateway: SessionGateway, messages: CoreMessage[]): void {
    if (messages.length === 0) {
      return;
    }

    const existing = this.get(sessionId);
    if (existing) {
      this.save({
        ...existing,
        updatedAt: new Date().toISOString(),
        title: deriveSessionTitle(messages),
        messages: [...messages],
      });
    } else {
      const now = new Date().toISOString();
      this.save({
        id: sessionId,
        gateway,
        gatewayKey: sessionId,
        messages: [...messages],
        title: deriveSessionTitle(messages),
        createdAt: now,
        updatedAt: now,
      });
    }

    this.setActiveSessionId(gateway, sessionId);
  }

  // ---------------------------------------------------------------------------
  // Active session tracking (per gateway)
  // ---------------------------------------------------------------------------

  getActiveSessionId(gateway: SessionGateway): string | undefined {
    return this.readState()[gateway];
  }

  setActiveSessionId(gateway: SessionGateway, sessionId: string): void {
    const state = this.readState();
    state[gateway] = sessionId;
    this.ensureDir();
    fs.writeFileSync(this.statePath(), JSON.stringify(state, null, 2), 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Session lookup by gateway key (used by Telegram / TUI)
  // ---------------------------------------------------------------------------

  findLatestByGatewayKey(gateway: SessionGateway, gatewayKey: string): PersistedSession | undefined {
    this.ensureDir();

    const files = fs
      .readdirSync(this.sessionsDir)
      .filter((f) => f.endsWith('.json') && f !== '.state.json');

    let latest: PersistedSession | undefined;

    for (const file of files) {
      const session = this.readFile(path.join(this.sessionsDir, file));
      if (
        session
        && session.gateway === gateway
        && session.gatewayKey === gatewayKey
        && (!latest || session.updatedAt > latest.updatedAt)
      ) {
        latest = session;
      }
    }

    return latest;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private statePath(): string {
    return path.join(this.sessionsDir, '.state.json');
  }

  private readState(): Partial<Record<SessionGateway, string>> {
    const filePath = this.statePath();
    if (!fs.existsSync(filePath)) {
      return {};
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<Record<SessionGateway, string>>;
    } catch {
      return {};
    }
  }

  private sessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  private readFile(filePath: string): PersistedSession | undefined {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PersistedSession;
    } catch {
      return undefined;
    }
  }

  private toSummary(session: PersistedSession): SessionSummary {
    const { messages, displayMessages: _display, ...rest } = session;
    return { ...rest, messageCount: messages.length };
  }
}
