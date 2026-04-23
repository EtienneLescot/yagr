import { YagrConfigService, type YagrConfigStoreLike, type YagrLocalConfig, type YagrTunnelReachabilityMode } from '../config/yagr-config-service.js';
export type TunnelReachabilityConsumer = 'telegram' | 'webui' | 'tui' | 'cli' | 'setup' | 'llm';
export declare function ensureConfiguredN8nTunnelReachability(consumer: TunnelReachabilityConsumer, configService?: YagrConfigService): Promise<void>;
export declare function ensureN8nAuthTunnelReachability(consumer: TunnelReachabilityConsumer, configService?: YagrConfigStoreLike): Promise<void>;
export declare function ensureFacadeTunnelReachability(consumer: TunnelReachabilityConsumer, configService?: YagrConfigService): Promise<void>;
export declare function ensureConfiguredLlmTunnelReachability(configService?: YagrConfigStoreLike): Promise<void>;
export declare function ensureLlmTunnelForRelayHostBaseUrl(hostBaseUrl: string, configService?: YagrConfigStoreLike): Promise<string>;
export declare function getTunnelReachabilityDebugSnapshot(configService?: YagrConfigStoreLike): {
    reachabilityMode: YagrTunnelReachabilityMode;
    forceAllFacades: boolean;
    localConfig: YagrLocalConfig;
};
export interface StartupTunnelPreflightResult {
    llmTunnel: {
        refreshed: boolean;
        publicUrl: string | null;
        skipped: boolean;
        reason?: string;
    };
    n8nTunnel: {
        refreshed: boolean;
        publicUrl: string | null;
        skipped: boolean;
        reason?: string;
    };
}
export declare function ensureStartupTunnelReachability(configService?: YagrConfigService): Promise<StartupTunnelPreflightResult>;
//# sourceMappingURL=tunnel-reachability.d.ts.map