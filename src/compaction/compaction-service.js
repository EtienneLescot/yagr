import { DEFAULT_COMPACTION_CONFIG, buildCompactionContextBlock } from './compaction-types.js';
export class CompactionService {
    config;
    subscribers = new Set();
    states = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
    }
    getConfig() {
        return { ...this.config };
    }
    getState(sessionId) {
        const state = this.states.get(sessionId) ?? this.emptyState();
        return {
            lastCompaction: state.lastCompaction,
            compactionHistory: [...state.compactionHistory],
            totalCompactions: state.totalCompactions,
        };
    }
    getContextBlock(sessionId, limit = 3) {
        return buildCompactionContextBlock(this.getState(sessionId), limit);
    }
    subscribe(subscriber) {
        this.subscribers.add(subscriber);
        return () => this.subscribers.delete(subscriber);
    }
    async notifyCompaction(sessionId, event) {
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
            }
            catch (err) {
                console.error('[CompactionService] Subscriber error:', err);
            }
        });
        await Promise.allSettled(notifications);
    }
    reset(sessionId) {
        if (!sessionId) {
            this.states.clear();
            return;
        }
        this.states.delete(sessionId);
    }
    setState(sessionId, state) {
        this.states.set(sessionId, {
            lastCompaction: state.lastCompaction,
            compactionHistory: [...state.compactionHistory],
            totalCompactions: state.totalCompactions,
        });
    }
    emptyState() {
        return {
            lastCompaction: null,
            compactionHistory: [],
            totalCompactions: 0,
        };
    }
}
//# sourceMappingURL=compaction-service.js.map