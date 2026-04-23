import type { GatewaySurface } from '../gateway/types.js';
import { type YagrModelProvider } from '../llm/provider-registry.js';
export declare function normalizeGatewaySurfaces(surfaces: readonly string[] | undefined): GatewaySurface[];
export interface YagrTelegramLinkedChat {
    chatId: string;
    userId?: string;
    username?: string;
    firstName?: string;
    linkedAt: string;
    lastSeenAt?: string;
}
export interface YagrTelegramConfig {
    botUsername?: string;
    onboardingToken?: string;
    linkedChats?: YagrTelegramLinkedChat[];
}
export interface YagrGatewayConfig {
    enabledSurfaces?: GatewaySurface[];
    webui?: {
        host?: string;
        port?: number;
    };
}
export type YagrLlmProxyMode = 'local' | 'docker' | 'tunnel';
export interface YagrLlmProxyConfig {
    enabled: boolean;
    mode: YagrLlmProxyMode;
    /** Target URL computed at onboard time (may be docker host or tunnel). Used to build the credential URL. */
    credentialBaseUrl: string;
    /** URL last confirmed written into the n8n credential by yagr_proxy_relay_start. Used to detect stale credentials. */
    confirmedCredentialBaseUrl?: string;
    /** docker bridge gateway address, only set when mode=docker */
    dockerHostAddress?: string;
    /** Cloudflare LLM tunnel URL, only set when mode=tunnel */
    llmTunnelUrl?: string;
}
export interface N8nTunnelConfig {
    /** Whether the user has enabled the n8n exposure tunnel. */
    enabled: boolean;
    /** The local n8n URL being tunneled (e.g. http://127.0.0.1:5678). */
    targetUrl: string;
    /** Last known public Cloudflare URL — may be stale if the daemon was restarted. */
    publicUrl?: string;
}
export type YagrTunnelReachabilityMode = 'on-demand' | 'force-all-facades';
export interface YagrTunnelBehaviorConfig {
    /**
     * 'force-all-facades' (default): all facades wake public tunnels for uniform public URL sharing.
     * 'on-demand': only remote consumers wake public tunnels.
     */
    reachabilityMode?: YagrTunnelReachabilityMode;
}
export type YagrShellCommandsMode = 'allow-all' | 'user-approved';
export interface YagrShellCommandsConfig {
    /** 'allow-all': every command is allowed. 'user-approved': only approved[] prefixes pass. */
    mode: YagrShellCommandsMode;
    /** Prefix list used when mode is 'user-approved'. Each entry is matched against the start of the command. */
    approved?: string[];
}
export interface YagrLocalConfig {
    provider?: YagrModelProvider;
    model?: string;
    baseUrl?: string;
    reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    gateway?: YagrGatewayConfig;
    telegram?: YagrTelegramConfig;
    llmProxy?: YagrLlmProxyConfig;
    shellCommands?: YagrShellCommandsConfig;
    n8nTunnel?: N8nTunnelConfig;
    tunnels?: YagrTunnelBehaviorConfig;
}
export interface YagrConfigStoreLike {
    getLocalConfig(): YagrLocalConfig;
    saveLocalConfig(config: YagrLocalConfig): void;
    updateLocalConfig(updater: (config: YagrLocalConfig) => YagrLocalConfig): YagrLocalConfig;
    getEnabledGatewaySurfaces(): GatewaySurface[];
    setEnabledGatewaySurfaces(surfaces: GatewaySurface[]): YagrLocalConfig;
    enableGatewaySurface(surface: GatewaySurface): YagrLocalConfig;
    disableGatewaySurface(surface: GatewaySurface): YagrLocalConfig;
    getApiKey(provider: YagrModelProvider): string | undefined;
    saveApiKey(provider: YagrModelProvider, apiKey: string): void;
    getTelegramBotToken(): string | undefined;
    saveTelegramBotToken(botToken: string): void;
    clearTelegramBotToken(): void;
    getLlmProxyConfig(): YagrLlmProxyConfig | undefined;
    isLlmProxyEnabled(): boolean;
    saveLlmProxyConfig(config: YagrLlmProxyConfig): YagrLocalConfig;
    updateLlmProxyCredentialBaseUrl(credentialBaseUrl: string): void;
    getN8nTunnelConfig(): N8nTunnelConfig | undefined;
    saveN8nTunnelConfig(config: N8nTunnelConfig): YagrLocalConfig;
    clearN8nTunnelConfig(): YagrLocalConfig;
    clearLocalConfig?(): void;
    clearAllApiKeys?(): void;
}
export declare class YagrConfigService {
    private readonly globalStore;
    private readonly localConfigPath;
    constructor();
    getLocalConfig(): YagrLocalConfig;
    saveLocalConfig(config: YagrLocalConfig): void;
    updateLocalConfig(updater: (config: YagrLocalConfig) => YagrLocalConfig): YagrLocalConfig;
    getEnabledGatewaySurfaces(): GatewaySurface[];
    setEnabledGatewaySurfaces(surfaces: GatewaySurface[]): YagrLocalConfig;
    enableGatewaySurface(surface: GatewaySurface): YagrLocalConfig;
    disableGatewaySurface(surface: GatewaySurface): YagrLocalConfig;
    getApiKey(provider: YagrModelProvider): string | undefined;
    saveApiKey(provider: YagrModelProvider, apiKey: string): void;
    hasApiKey(provider: YagrModelProvider): boolean;
    clearLocalConfig(): void;
    clearAllApiKeys(): void;
    getTelegramBotToken(): string | undefined;
    saveTelegramBotToken(botToken: string): void;
    clearTelegramBotToken(): void;
    getLlmProxyConfig(): YagrLlmProxyConfig | undefined;
    isLlmProxyEnabled(): boolean;
    saveLlmProxyConfig(config: YagrLlmProxyConfig): YagrLocalConfig;
    updateLlmProxyCredentialBaseUrl(credentialBaseUrl: string): void;
    getN8nTunnelConfig(): N8nTunnelConfig | undefined;
    saveN8nTunnelConfig(config: N8nTunnelConfig): YagrLocalConfig;
    clearN8nTunnelConfig(): YagrLocalConfig;
}
//# sourceMappingURL=yagr-config-service.d.ts.map