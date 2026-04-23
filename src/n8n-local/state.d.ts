export interface ManagedN8nInstanceState {
    strategy: 'docker' | 'direct';
    image?: string;
    port: number;
    url: string;
    composeFile?: string;
    envFile?: string;
    dataDir: string;
    logFile?: string;
    pid?: number;
    status: 'created' | 'starting' | 'ready' | 'stopped' | 'error';
    bootstrapStage: 'runtime-only' | 'owner-pending' | 'api-key-pending' | 'connected';
    createdAt: string;
    updatedAt: string;
    lastError?: string;
}
export interface ManagedN8nPaths {
    rootDir: string;
    stateFile: string;
    composeFile: string;
    envFile: string;
    dataDir: string;
    logFile: string;
}
export declare function getManagedN8nPaths(): ManagedN8nPaths;
export declare function ensureManagedN8nDirs(): ManagedN8nPaths;
export declare function readManagedN8nState(): ManagedN8nInstanceState | undefined;
export declare function writeManagedN8nState(state: ManagedN8nInstanceState): ManagedN8nInstanceState;
export declare function buildManagedN8nState(input: {
    strategy?: ManagedN8nInstanceState['strategy'];
    image: string;
    port: number;
    status?: ManagedN8nInstanceState['status'];
    bootstrapStage?: ManagedN8nInstanceState['bootstrapStage'];
    lastError?: string;
    pid?: number;
    logFile?: string;
}): ManagedN8nInstanceState;
export declare function updateManagedN8nState(updater: (current: ManagedN8nInstanceState | undefined) => ManagedN8nInstanceState): ManagedN8nInstanceState;
export declare function markManagedN8nBootstrapStage(url: string, bootstrapStage: ManagedN8nInstanceState['bootstrapStage']): ManagedN8nInstanceState | undefined;
export declare function resolveManagedN8nBootstrapStage(url: string): ManagedN8nInstanceState['bootstrapStage'];
//# sourceMappingURL=state.d.ts.map