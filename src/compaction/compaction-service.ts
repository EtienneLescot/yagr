import type { YagrContextCompactionEvent } from '../types.js';
import type { CompactionConfig, CompactionState, CompactionSubscriber } from './compaction-types.js';
import { DEFAULT_COMPACTION_CONFIG, buildCompactionContextBlock } from './compaction-types.js';

export class CompactionService {
  private readonly config: CompactionConfig;
  private readonly subscribers = new Set<CompactionSubscriber>();
  private readonly states = new Map<string, CompactionState>();

  constructor(config: Partial<CompactionConfig> = {}) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  }

  getConfig(): CompactionConfig {
    return { ...this.config };
  }

  getState(sessionId: string): CompactionState {
    const state = this.states.get(sessionId) ?? this.emptyState();
    return {
      lastCompaction: state.lastCompaction,
      compactionHistory: [...state.compactionHistory],
      totalCompactions: state.totalCompactions,
    };
  }

  getContextBlock(sessionId: string, limit = 3): string {
    return buildCompactionContextBlock(this.getState(sessionId), limit);
  }

  subscribe(subscriber: CompactionSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async notifyCompaction(sessionId: string, event: YagrContextCompactionEvent): Promise<void> {
    const previousState = this.states.get(sessionId) ?? this.emptyState();
    this.states.set(sessionId, {
      lastCompaction: event,
      compactionHistory: [
        event,
        ...previousState.compactionHistory.slice(0, (this.config.historyLimit ?? 50) - 1),
      ],
      totalCompactions: previousState.totalCompactions + 1,
    });

    const notifications = [...this.subscribers].map(async (s) => {
      try {
        await s.onCompaction(event);
      } catch (err) {
        console.error('[CompactionService] Subscriber error:', err);
      }
    });

    await Promise.allSettled(notifications);
  }

  reset(sessionId?: string): void {
    if (!sessionId) {
      this.states.clear();
      return;
    }

    this.states.delete(sessionId);
  }

  private emptyState(): CompactionState {
    return {
      lastCompaction: null,
      compactionHistory: [],
      totalCompactions: 0,
    };
  }
}
