import type { YagrContextCompactionEvent, YagrManualCompactionOptions, YagrManualCompactionResult } from '../types.js';
import type { CompactionConfig, CompactionState, CompactionSubscriber, SessionCompactor } from './compaction-types.js';
import { DEFAULT_COMPACTION_CONFIG, buildCompactionContextBlock } from './compaction-types.js';

export class CompactionService {
  private readonly config: CompactionConfig;
  private readonly subscribers = new Set<CompactionSubscriber>();
  private readonly states = new Map<string, CompactionState>();
  private readonly sessionCompactor?: SessionCompactor;

  constructor(config: Partial<CompactionConfig> = {}, sessionCompactor?: SessionCompactor) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
    this.sessionCompactor = sessionCompactor;
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

  async compactSession(sessionId: string, options: YagrManualCompactionOptions = {}): Promise<YagrManualCompactionResult> {
    if (!this.sessionCompactor) {
      return {
        status: 'unavailable',
        reason: 'Compaction runtime is not available.',
      };
    }

    const result = await this.sessionCompactor(sessionId, options);
    if (result.status === 'completed' && result.event) {
      await this.notifyCompaction(sessionId, result.event);
    }
    return result;
  }

  reset(sessionId?: string): void {
    if (!sessionId) {
      this.states.clear();
      return;
    }

    this.states.delete(sessionId);
  }

  setState(sessionId: string, state: CompactionState): void {
    this.states.set(sessionId, {
      lastCompaction: state.lastCompaction,
      compactionHistory: [...state.compactionHistory],
      totalCompactions: state.totalCompactions,
    });
  }

  private emptyState(): CompactionState {
    return {
      lastCompaction: null,
      compactionHistory: [],
      totalCompactions: 0,
    };
  }
}
