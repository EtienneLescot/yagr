import { type ManagedN8nInstanceState } from './state.js';
export interface InstallManagedDockerN8nOptions {
    image?: string;
    port?: number;
}
export interface ManagedDockerN8nStatus {
    installed: boolean;
    running: boolean;
    healthy: boolean;
    url?: string;
    state?: ManagedN8nInstanceState;
}
export declare function installManagedDockerN8n(options?: InstallManagedDockerN8nOptions): Promise<ManagedN8nInstanceState>;
export declare function startManagedDockerN8n(): Promise<ManagedN8nInstanceState>;
export declare function getManagedDockerN8nStatus(): Promise<ManagedDockerN8nStatus>;
export declare function stopManagedDockerN8n(): Promise<ManagedN8nInstanceState>;
export declare function getManagedDockerN8nLogs(tail?: number): Promise<string>;
//# sourceMappingURL=docker-manager.d.ts.map