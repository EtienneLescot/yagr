export interface LocalOpenBridgeState {
    port: number;
    pid: number;
    startedAt: string;
}
export declare function resolveStoredWorkflowOpenTarget(token: string): string;
export declare function decodeHtmlDataUrl(dataUrl: string): string;
export declare function ensureLocalN8nAuthBridgeRunning(): Promise<void>;
export declare function ensureLocalN8nAuthBridgeRunningInProcess(): Promise<void>;
export declare function stopLocalN8nAuthBridge(): Promise<void>;
export declare function buildLocalWorkflowOpenBridgeUrl(target: string): string;
export declare function buildHostedWorkflowOpenBridgeUrl(baseUrl: string, target: string): string;
export declare function getLocalN8nAuthBridgeBaseUrl(): string;
export declare function ensureLocalWorkflowOpenBridgeRunning(): Promise<void>;
export declare function resolvePreferredWorkflowOpenBridgeUrl(target: string, fallbackBaseUrl?: string): string;
//# sourceMappingURL=local-open-bridge.d.ts.map