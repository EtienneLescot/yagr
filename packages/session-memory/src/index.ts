import fs from 'node:fs';
import path from 'node:path';

export interface SessionMemoryRecord {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  summary: string;
  toolsUsed: string[];
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: unknown;
}

export interface SessionMemoryAdapter {
  persist(record: SessionMemoryRecord): void;
  delete(sessionId: string): void;
  get(sessionId: string): SessionMemoryRecord | undefined;
  list(limit?: number): SessionMemoryRecord[];
  buildContextBlock(limit?: number): string;
}

export class FileSessionMemoryAdapter implements SessionMemoryAdapter {
  constructor(private readonly memoriesDir: string) {}

  persist(record: SessionMemoryRecord): void {
    this.ensureDir();
    fs.writeFileSync(this.recordPath(record.sessionId), JSON.stringify(record, null, 2), 'utf-8');
  }

  delete(sessionId: string): void {
    const filePath = this.recordPath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
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

  list(limit = 20): SessionMemoryRecord[] {
    if (!fs.existsSync(this.memoriesDir)) {
      return [];
    }
    const files = fs.readdirSync(this.memoriesDir).filter((file) => file.endsWith('.json'));
    const records: SessionMemoryRecord[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.memoriesDir, file), 'utf-8');
        records.push(JSON.parse(raw) as SessionMemoryRecord);
      } catch {
        // Skip corrupt files.
      }
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  buildContextBlock(limit = 6): string {
    const records = this.list(limit);
    if (records.length === 0) {
      return '';
    }
    const lines = records.map((record) => {
      const date = record.updatedAt.slice(0, 10);
      const tools = record.toolsUsed.length > 0 ? ` Tools: ${record.toolsUsed.join(', ')}.` : '';
      const summary = record.summary ? ` ${record.summary}` : '';
      return `[${date}] "${record.title}"${summary}${tools}`;
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

const NOISE_TOOLS = new Set(['reportProgress', 'requestRequiredAction']);

export function extractSessionMemory(
  sessionId: string,
  title: string,
  createdAt: string,
  messages: readonly SessionMessage[],
): SessionMemoryRecord {
  const userTexts: string[] = [];
  const toolNames = new Set<string>();
  let lastAssistantText = '';

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = extractTextFromContent(msg.content);
      if (text) {
        userTexts.push(text.slice(0, 120).replace(/\s+/g, ' ').trim());
      }
      continue;
    }

    if (msg.role !== 'assistant') {
      continue;
    }

    const parts = Array.isArray(msg.content) ? msg.content : [];
    for (const part of parts) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const typedPart = part as Record<string, unknown>;
      if (typedPart.type === 'text') {
        const text = String(typedPart.text ?? '').trim();
        if (text) {
          lastAssistantText = text.slice(0, 220).replace(/\s+/g, ' ');
        }
      }

      if (typedPart.type !== 'tool-call') {
        continue;
      }

      const toolName = String(typedPart.toolName ?? '');
      if (toolName && !NOISE_TOOLS.has(toolName)) {
        toolNames.add(toolName);
      }
    }

    if (typeof msg.content === 'string' && msg.content.trim()) {
      lastAssistantText = msg.content.slice(0, 220).replace(/\s+/g, ' ');
    }
  }

  const summaryParts: string[] = [];
  const distinctRequests = [...new Set(userTexts)].slice(0, 2);
  if (distinctRequests.length > 0) {
    summaryParts.push(`Requests: ${distinctRequests.map((text) => `"${text}"`).join('; ')}.`);
  }
  if (lastAssistantText) {
    summaryParts.push(`Last response: ${lastAssistantText.length > 180 ? `${lastAssistantText.slice(0, 177)}…` : lastAssistantText}`);
  }

  return {
    sessionId,
    title,
    createdAt,
    updatedAt: new Date().toISOString(),
    summary: summaryParts.join(' '),
    toolsUsed: [...toolNames].sort(),
  };
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((part): part is { type: 'text'; text: string } => Boolean(part && typeof part === 'object' && (part as { type?: string }).type === 'text'))
    .map((part) => part.text)
    .join(' ');
}
