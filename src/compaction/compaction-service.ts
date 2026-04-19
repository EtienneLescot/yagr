import type { YagrContextCompactionEvent } from '../types.js';
import type { CompactionConfig, CompactionState, CompactionSubscriber } from './compaction-types.js';
import { DEFAULT_COMPACTION_CONFIG, buildCompactionContextBlock } from './compaction-types.js';

export class CompactionService {
  private readonly config: CompactionConfig;
  private readonly subscribers = new Set<CompactionSubscriber>();
  private state: CompactionState = {
    lastCompaction: null,
    compactionHistory: [],
    totalCompactions: 0,
  };

  constructor(config: Partial<CompactionConfig> = {}) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
  }

  getConfig(): CompactionConfig {
    return { ...this.config };
  }

  getState(): CompactionState {
    return {
      lastCompaction: this.state.lastCompaction,
      compactionHistory: [...this.state.compactionHistory],
      totalCompactions: this.state.totalCompactions,
    };
  }

  getContextBlock(limit = 3): string {
    return buildCompactionContextBlock(this.state, limit);
  }

  subscribe(subscriber: CompactionSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async notifyCompaction(event: YagrContextCompactionEvent): Promise<void> {
    this.state = {
      lastCompaction: event,
      compactionHistory: [
        event,
        ...this.state.compactionHistory.slice(0, (this.config.historyLimit ?? 50) - 1),
      ],
      totalCompactions: this.state.totalCompactions + 1,
    };

    const notifications = [...this.subscribers].map(async (s) => {
      try {
        await s.onCompaction(event);
      } catch (err) {
        console.error('[CompactionService] Subscriber error:', err);
      }
    });

    await Promise.allSettled(notifications);
  }

  reset(): void {
    this.state = {
      lastCompaction: null,
      compactionHistory: [],
      totalCompactions: 0,
    };
  }
}

const globalCompactionService = new CompactionService();

export function getGlobalCompactionService(): CompactionService {
  return globalCompactionService;
}
