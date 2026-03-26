import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CoreMessage } from 'ai';
import type { PersistedSession, SessionGateway, SessionSummary } from './session-types.js';

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
 * Create a new PersistedSession from scratch.
 */
export function createSession(
  gateway: SessionGateway,
  gatewayKey: string,
  messages: readonly CoreMessage[] = [],
): PersistedSession {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    title: deriveSessionTitle(messages),
    gateway,
    gatewayKey,
    messages: [...messages],
  };
}

/**
 * SSOT file-based session store.
 *
 * One JSON file per session in `${YAGR_HOME}/sessions/`.
 * Listing is done by scanning the directory — no separate index file needed
 * given the expected scale (tens to a few hundreds of sessions).
 */
export class SessionStore {
  constructor(private readonly sessionsDir: string) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  list(gateway?: SessionGateway): SessionSummary[] {
    this.ensureDir();

    const files = fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'));
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

  /**
   * Find the most recent session for a gateway / key pair.
   * Used by Telegram (match on chatId) and TUI (match on "default").
   */
  findLatestByGatewayKey(gateway: SessionGateway, gatewayKey: string): PersistedSession | undefined {
    this.ensureDir();

    const files = fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'));
    let latest: PersistedSession | undefined;

    for (const file of files) {
      const session = this.readFile(path.join(this.sessionsDir, file));
      if (
        session &&
        session.gateway === gateway &&
        session.gatewayKey === gatewayKey &&
        (!latest || session.updatedAt > latest.updatedAt)
      ) {
        latest = session;
      }
    }

    return latest;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private ensureDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Build a safe file path for a session ID.
   * Validates the ID contains only UUID-safe characters to prevent path traversal.
   */
  private sessionPath(sessionId: string): string {
    if (!/^[\w-]{1,128}$/.test(sessionId)) {
      throw new Error(`Invalid session ID: ${sessionId}`);
    }

    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  private readFile(filePath: string): PersistedSession | undefined {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as PersistedSession;
    } catch {
      return undefined;
    }
  }

  private toSummary(session: PersistedSession): SessionSummary {
    const { messages, ...rest } = session;
    return { ...rest, messageCount: messages.length };
  }
}
