import type { BaseCheckpointSaver, CheckpointTuple } from '@langchain/langgraph-checkpoint';
import type { CheckpointMetadata, DeepAgentSessionRecord, DeepAgentSessionScope } from './session-types.js';
export interface CreateDeepAgentSessionOptions {
    id?: string;
    title?: string;
    scope?: DeepAgentSessionScope;
}
export interface TouchDeepAgentSessionOptions {
    title?: string;
    closed?: boolean;
}
export declare function buildDeepAgentSessionConfig(sessionId: string): {
    configurable: {
        thread_id: string;
    };
};
export declare function deriveSessionTitle(text: string, fallback?: string): string;
export declare class DeepAgentSessionStore {
    private readonly sessionsDir;
    constructor(sessionsDir: string);
    getSessionsDir(): string;
    list(): DeepAgentSessionRecord[];
    get(sessionId: string): DeepAgentSessionRecord | undefined;
    create(options?: CreateDeepAgentSessionOptions): DeepAgentSessionRecord;
    ensure(sessionId: string, options?: Omit<CreateDeepAgentSessionOptions, 'id'>): DeepAgentSessionRecord;
    touch(sessionId: string, options?: TouchDeepAgentSessionOptions): DeepAgentSessionRecord | undefined;
    getActiveForScope(scope: DeepAgentSessionScope): DeepAgentSessionRecord | undefined;
    getOrCreateActiveForScope(scope: DeepAgentSessionScope, options?: Omit<CreateDeepAgentSessionOptions, 'id' | 'scope'>): DeepAgentSessionRecord;
    rotateActiveForScope(scope: DeepAgentSessionScope, options?: Omit<CreateDeepAgentSessionOptions, 'id' | 'scope'>): DeepAgentSessionRecord;
    clearActiveScope(scope: DeepAgentSessionScope): void;
    delete(sessionId: string): void;
    deleteThread(checkpointer: BaseCheckpointSaver, sessionId: string): Promise<void>;
    private save;
    private recordPath;
    private scopeStatePath;
    private setActiveScope;
    private scopeKey;
    private scopeChanged;
    private readScopeState;
    private writeScopeState;
    private readRecord;
    private ensureDir;
}
export declare class CheckpointManager {
    private readonly checkpointer;
    private readonly sessionsDir;
    constructor(checkpointer: BaseCheckpointSaver, sessionsDir: string);
    private checkpointDir;
    private checkpointPath;
    listCheckpointsSync(sessionId: string): CheckpointMetadata[];
    getCheckpoint(sessionId: string, checkpointId: string): Promise<{
        tuple: CheckpointTuple;
        metadata: CheckpointMetadata;
    } | undefined>;
    saveCheckpoint(sessionId: string): Promise<CheckpointMetadata>;
    restoreCheckpoint(sessionId: string, checkpointId: string): Promise<void>;
    deleteCheckpoint(sessionId: string, checkpointId: string): Promise<void>;
    deleteAllCheckpoints(sessionId: string): Promise<void>;
    private countMessages;
    private buildRestoreConfig;
    private buildFallbackLangGraphMetadata;
    private groupPendingWritesByTask;
}
export type { CheckpointMetadata, DeepAgentSessionRecord, DeepAgentSessionScope } from './session-types.js';
//# sourceMappingURL=index.d.ts.map