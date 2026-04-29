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
export type YagrShellCommandsMode = 'allow-all' | 'user-approved';
export interface YagrShellCommandsConfig {
    mode: YagrShellCommandsMode;
    approved?: string[];
}
export interface YagrLocalConfig {
    provider?: YagrModelProvider;
    model?: string;
    baseUrl?: string;
    reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    gateway?: YagrGatewayConfig;
    telegram?: YagrTelegramConfig;
    shellCommands?: YagrShellCommandsConfig;
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
}
//# sourceMappingURL=yagr-config-service.d.ts.map