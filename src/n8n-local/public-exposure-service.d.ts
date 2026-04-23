import { type YagrConfigStoreLike } from '../config/yagr-config-service.js';
import { buildRelayInfo } from '../llm/llm-relay-server.js';
import { type N8nTunnelState } from './n8n-tunnel.js';
export type N8nPublicExposureAction = 'ensure' | 'start' | 'refresh';
export interface ManagedN8nRestartHooks {
    onStart?: (publicUrl: string) => void;
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
}
export interface N8nPublicExposureResult {
    state: N8nTunnelState;
    previousPublicUrl?: string;
    restartedManagedN8n: boolean;
}
export declare function restartManagedN8nForTunnel(publicUrl: string, hooks?: ManagedN8nRestartHooks): Promise<boolean>;
export declare function ensureN8nPublicExposure(targetUrl: string, options?: {
    action?: N8nPublicExposureAction;
    cloudflaredBin?: string;
    configService?: YagrConfigStoreLike;
    restartHooks?: ManagedN8nRestartHooks;
}): Promise<N8nPublicExposureResult>;
export declare function ensureConfiguredN8nPublicExposure(options?: {
    action?: N8nPublicExposureAction;
    cloudflaredBin?: string;
    configService?: YagrConfigStoreLike;
    restartHooks?: ManagedN8nRestartHooks;
}): Promise<N8nPublicExposureResult>;
export declare function ensureN8nAuthPublicExposure(options?: {
    cloudflaredBin?: string;
}): Promise<{
    publicUrl: string;
    targetUrl: string;
}>;
export declare function ensureConfiguredLlmPublicExposure(configService?: YagrConfigStoreLike): Promise<string | null>;
export declare function refreshLlmPublicExposureForRelayHostBaseUrl(hostBaseUrl: string, configService?: YagrConfigStoreLike, cloudflaredBin?: string): Promise<string>;
export declare function stopN8nPublicExposureSet(configService?: YagrConfigStoreLike): Promise<void>;
export declare function getConfiguredLlmRelayInfoWithExposure(configService?: YagrConfigStoreLike): Promise<ReturnType<typeof buildRelayInfo>>;
//# sourceMappingURL=public-exposure-service.d.ts.map