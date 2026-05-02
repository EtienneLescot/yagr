import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type ImpactActor = 'agent' | 'user' | 'runtime' | 'tool';

export type ImpactCategory =
  | 'file_change'
  | 'shell_command'
  | 'process_started'
  | 'process_stopped'
  | 'dependency_change'
  | 'automation_created'
  | 'automation_updated'
  | 'automation_removed'
  | 'external_call'
  | 'credential_access'
  | 'artifact_created'
  | 'checkpoint'
  | 'decision';

export type ImpactLevel = 'low' | 'medium' | 'high';
export type ImpactPersistence = 'ephemeral' | 'durable' | 'unknown';
export type ImpactReversibility = boolean | 'unknown';

export interface ImpactEvent {
  id: string;
  sessionId: string;
  turnId?: string;
  taskId?: string;
  operationId?: string;
  timestamp: string;
  actor: ImpactActor;
  category: ImpactCategory;
  impact: ImpactLevel;
  persistence: ImpactPersistence;
  reversible: ImpactReversibility;
  summary: string;
  evidence: unknown;
  relatedFiles?: string[];
  relatedCommands?: string[];
  artifactId?: string;
}

export type ImpactEventInput = Omit<ImpactEvent, 'id' | 'timestamp'> & Partial<Pick<ImpactEvent, 'id' | 'timestamp'>>;

export interface ImpactLedgerQuery {
  sessionId?: string;
  category?: ImpactCategory | readonly ImpactCategory[];
  artifactId?: string;
  since?: string | Date;
  until?: string | Date;
  limit?: number;
}

export interface ImpactLedger {
  append(event: ImpactEventInput): ImpactEvent;
  list(query?: ImpactLedgerQuery): ImpactEvent[];
  listBySession(sessionId: string, query?: Omit<ImpactLedgerQuery, 'sessionId'>): ImpactEvent[];
  listByCategory(category: ImpactCategory, query?: Omit<ImpactLedgerQuery, 'category'>): ImpactEvent[];
  listByArtifact(artifactId: string, query?: Omit<ImpactLedgerQuery, 'artifactId'>): ImpactEvent[];
}

export interface ImpactSummary {
  events: ImpactEvent[];
  message: string;
}

export class FileImpactLedger implements ImpactLedger {
  constructor(private readonly ledgerPath: string) {}

  append(input: ImpactEventInput): ImpactEvent {
    const event: ImpactEvent = {
      ...input,
      id: input.id ?? `impact_${randomUUID()}`,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
    this.ensureDir();
    fs.appendFileSync(this.ledgerPath, `${JSON.stringify(event)}\n`, 'utf-8');
    return event;
  }

  list(query: ImpactLedgerQuery = {}): ImpactEvent[] {
    const events = this.readAll().filter((event) => matchesQuery(event, query));
    const sorted = events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return typeof query.limit === 'number' ? sorted.slice(0, Math.max(0, query.limit)) : sorted;
  }

  listBySession(sessionId: string, query: Omit<ImpactLedgerQuery, 'sessionId'> = {}): ImpactEvent[] {
    return this.list({ ...query, sessionId });
  }

  listByCategory(category: ImpactCategory, query: Omit<ImpactLedgerQuery, 'category'> = {}): ImpactEvent[] {
    return this.list({ ...query, category });
  }

  listByArtifact(artifactId: string, query: Omit<ImpactLedgerQuery, 'artifactId'> = {}): ImpactEvent[] {
    return this.list({ ...query, artifactId });
  }

  private readAll(): ImpactEvent[] {
    if (!fs.existsSync(this.ledgerPath)) {
      return [];
    }
    const raw = fs.readFileSync(this.ledgerPath, 'utf-8');
    const events: ImpactEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        events.push(JSON.parse(trimmed) as ImpactEvent);
      } catch {
        // Keep the append-only ledger readable even if one line is corrupt.
      }
    }
    return events;
  }

  private ensureDir(): void {
    fs.mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
  }
}

export function defaultImpactLedgerPath(yagrHome: string): string {
  return path.join(yagrHome, 'impact-ledger.jsonl');
}

export function createFileImpactLedger(yagrHome: string): FileImpactLedger {
  return new FileImpactLedger(defaultImpactLedgerPath(yagrHome));
}

export function buildImpactSummary(ledger: ImpactLedger, query: ImpactLedgerQuery = {}): ImpactSummary {
  const limit = query.limit ?? 12;
  const events = ledger.list({ ...query, limit });
  if (events.length === 0) {
    return {
      events,
      message: query.sessionId
        ? 'No impact events recorded for this session yet.'
        : 'No impact events recorded yet.',
    };
  }

  const counts = countBy(events, (event) => event.category);
  const categorySummary = Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([category, count]) => `${category}: ${count}`)
    .join(', ');

  const lines = events.map((event, index) => {
    const time = new Date(event.timestamp).toLocaleString();
    const files = event.relatedFiles?.length ? ` files=${event.relatedFiles.join(',')}` : '';
    const commands = event.relatedCommands?.length ? ` commands=${event.relatedCommands.join(' | ')}` : '';
    return `${index + 1}. [${event.impact}/${event.persistence}] ${event.category} — ${event.summary} (${time})${files}${commands}`;
  });

  return {
    events,
    message: `Impact events (${events.length}${query.sessionId ? ' for this session' : ''})\nCategories: ${categorySummary}\n${lines.join('\n')}`,
  };
}

function matchesQuery(event: ImpactEvent, query: ImpactLedgerQuery): boolean {
  if (query.sessionId && event.sessionId !== query.sessionId) {
    return false;
  }
  if (query.artifactId && event.artifactId !== query.artifactId) {
    return false;
  }
  if (query.category) {
    const categories = Array.isArray(query.category) ? query.category : [query.category];
    if (!categories.includes(event.category)) {
      return false;
    }
  }
  if (query.since && event.timestamp < toIsoString(query.since)) {
    return false;
  }
  if (query.until && event.timestamp > toIsoString(query.until)) {
    return false;
  }
  return true;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function countBy<T extends string>(items: readonly ImpactEvent[], select: (item: ImpactEvent) => T): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const item of items) {
    const key = select(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
