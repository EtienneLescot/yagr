import { type YagrModelProvider } from './provider-registry.js';
export interface PreparedProviderRuntime {
    provider: YagrModelProvider;
    baseUrl: string;
    apiKey?: string;
    /** Provider-specific headers to add to every upstream request (e.g. Editor-Version for Copilot). */
    extraHeaders?: Record<string, string>;
    models: string[];
    notes: string[];
    logPath?: string;
    autoStarted: boolean;
}
export interface PrepareProviderRuntimeResult {
    ready: boolean;
    runtime?: PreparedProviderRuntime;
    reason?: string;
    notes: string[];
}
export interface ProxyRuntimeStatus {
    provider: YagrModelProvider;
    configuredBaseUrl?: string;
    running: boolean;
    pid?: number;
    command?: string;
    logPath?: string;
    startedAt?: string;
    managed: boolean;
}
export declare function prepareProviderRuntime(provider: YagrModelProvider, options?: {
    apiKey?: string;
    baseUrl?: string;
}): Promise<PrepareProviderRuntimeResult>;
export declare function startProviderProxy(provider: YagrModelProvider, options?: {
    baseUrl?: string;
}): ProxyRuntimeStatus;
export declare function stopProviderProxy(provider: YagrModelProvider): ProxyRuntimeStatus;
export declare function getProxyRuntimeStatus(provider: YagrModelProvider): ProxyRuntimeStatus;
export declare function listProxyRuntimeStatuses(): ProxyRuntimeStatus[];
//# sourceMappingURL=proxy-runtime.d.ts.map