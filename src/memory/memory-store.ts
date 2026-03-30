import fs from 'node:fs';
import path from 'node:path';
import type { SessionMemoryRecord } from './memory-types.js';

/**
 * File-based store for cross-session memory records.
 *
 * One JSON file per session in `${YAGR_HOME}/memories/`.
 * The store is intentionally simple: no indexing, just sorted directory reads.
 * Memory files are small (< 1 KB each) so full scans are fast.
 */
export class MemoryStore {
  constructor(private readonly memoriesDir: string) {}

  save(record: SessionMemoryRecord): void {
    this.ensureDir();
    fs.writeFileSync(this.recordPath(record.sessionId), JSON.stringify(record, null, 2), 'utf-8');
  }

  get(sessionId: string): SessionMemoryRecord | undefined {
    const filePath = this.recordPath(sessionId);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionMemoryRecord;
    } catch {
      return undefined;
    }
  }

  /** Returns records sorted newest-first, up to `limit`. */
  list(limit = 20): SessionMemoryRecord[] {
    if (!fs.existsSync(this.memoriesDir)) {
      return [];
    }

    const files = fs
      .readdirSync(this.memoriesDir)
      .filter((f) => f.endsWith('.json'));

    const records: SessionMemoryRecord[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.memoriesDir, file), 'utf-8');
        records.push(JSON.parse(raw) as SessionMemoryRecord);
      } catch {
        // Skip corrupt files.
      }
    }

    return records
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  /**
   * Build a compact context block for injection into the system prompt.
   * Returns an empty string if no memories exist yet.
   *
   * Format (each record on one line, newest first):
   *   [YYYY-MM-DD] "Title" — <summary> Tools: x, y.
   */
  buildContextBlock(limit = 6): string {
    const records = this.list(limit);
    if (records.length === 0) {
      return '';
    }

    const lines = records.map((r) => {
      const date = r.updatedAt.slice(0, 10); // YYYY-MM-DD
      const tools = r.toolsUsed.length > 0 ? ` Tools: ${r.toolsUsed.join(', ')}.` : '';
      const summary = r.summary ? ` ${r.summary}` : '';
      return `[${date}] "${r.title}"${summary}${tools}`;
    });

    return `Recent session memory (${records.length} sessions): ${lines.join(' | ')}`;
  }

  private recordPath(sessionId: string): string {
    return path.join(this.memoriesDir, `${sessionId}.json`);
  }

  private ensureDir(): void {
    fs.mkdirSync(this.memoriesDir, { recursive: true });
  }
}
