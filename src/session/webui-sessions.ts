/**
 * Minimal WebUI session registry.
 *
 * Stores session metadata and rich display messages on disk so the WebUI
 * sidebar can list conversations across page reloads.  Conversation
 * messages themselves live in the LangGraph MemorySaver checkpointer — this
 * registry is strictly UI state, not agent state.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SerializedChatMessage, SessionSummary } from './session-types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebUiSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  displayMessages?: SerializedChatMessage[];
}

// ─── Class ────────────────────────────────────────────────────────────────────

export class WebUiSessionRegistry {
  constructor(private readonly sessionsDir: string) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  list(): SessionSummary[] {
    this.ensureDir();

    const files = fs
      .readdirSync(this.sessionsDir)
      .filter((f) => f.endsWith('.json') && f !== '.state.json');

    const results: SessionSummary[] = [];

    for (const file of files) {
      const session = this.readFile(path.join(this.sessionsDir, file));
      if (session) {
        results.push(this.toSummary(session));
      }
    }

    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(sessionId: string): WebUiSession | undefined {
    return this.readFile(this.sessionPath(sessionId));
  }

  createEmpty(sessionId: string): void {
    const now = new Date().toISOString();
    this.save({
      id: sessionId,
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
    });
  }

  save(session: WebUiSession): void {
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
  // Display messages
  // ---------------------------------------------------------------------------

  setDisplayMessages(sessionId: string, displayMessages: SerializedChatMessage[]): void {
    const session = this.get(sessionId);
    if (!session) {
      return;
    }
    this.save({ ...session, displayMessages });
  }

  // ---------------------------------------------------------------------------
  // Active session tracking
  // ---------------------------------------------------------------------------

  getActiveSessionId(): string | undefined {
    return this.readState().activeSessionId;
  }

  setActiveSessionId(sessionId: string): void {
    this.ensureDir();
    fs.writeFileSync(this.statePath(), JSON.stringify({ activeSessionId: sessionId }, null, 2), 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private toSummary(session: WebUiSession): SessionSummary {
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      gateway: 'webui',
      gatewayKey: session.id,
      messageCount: session.displayMessages?.length ?? 0,
    };
  }

  private sessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  private statePath(): string {
    return path.join(this.sessionsDir, '.state.json');
  }

  private readState(): { activeSessionId?: string } {
    const filePath = this.statePath();
    if (!fs.existsSync(filePath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { activeSessionId?: string };
    } catch {
      return {};
    }
  }

  private readFile(filePath: string): WebUiSession | undefined {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WebUiSession;
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
