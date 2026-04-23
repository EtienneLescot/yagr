import type { YagrContextCompactionEvent } from '../types.js';
import type { CompactionConfig, CompactionState, CompactionSubscriber } from './compaction-types.js';
export declare class CompactionService {
    private readonly config;
    private readonly subscribers;
    private readonly states;
    constructor(config?: Partial<CompactionConfig>);
    getConfig(): CompactionConfig;
    getState(sessionId: string): CompactionState;
    getContextBlock(sessionId: string, limit?: number): string;
    subscribe(subscriber: CompactionSubscriber): () => void;
    notifyCompaction(sessionId: string, event: YagrContextCompactionEvent): Promise<void>;
    reset(sessionId?: string): void;
    setState(sessionId: string, state: CompactionState): void;
    private emptyState;
}
//# sourceMappingURL=compaction-service.d.ts.map