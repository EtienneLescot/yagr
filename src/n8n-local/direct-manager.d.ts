import { type ManagedN8nInstanceState } from './state.js';
export declare function installManagedDirectN8n(options?: {
    port?: number;
}): Promise<ManagedN8nInstanceState>;
export declare function startManagedDirectN8n(): Promise<ManagedN8nInstanceState>;
export declare function stopManagedDirectN8n(): Promise<ManagedN8nInstanceState>;
export declare function getManagedDirectN8nLogs(): Promise<string>;
export declare function getManagedDirectN8nStatus(): Promise<{
    installed: boolean;
    running: boolean;
    healthy: boolean;
    url?: string;
    state?: ManagedN8nInstanceState;
}>;
//# sourceMappingURL=direct-manager.d.ts.map