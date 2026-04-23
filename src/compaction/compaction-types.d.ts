import type { YagrContextCompactionEvent } from '../types.js';
export interface CompactionState {
    lastCompaction: YagrContextCompactionEvent | null;
    compactionHistory: YagrContextCompactionEvent[];
    totalCompactions: number;
}
export interface CompactionSubscriber {
    onCompaction: (event: YagrContextCompactionEvent) => void | Promise<void>;
}
export interface CompactionConfig {
    historyLimit?: number;
}
export declare const DEFAULT_COMPACTION_CONFIG: CompactionConfig;
export declare function buildCompactionContextBlock(state: CompactionState, limit?: number): string;
//# sourceMappingURL=compaction-types.d.ts.map