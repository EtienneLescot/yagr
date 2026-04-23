import { N8nApiClient, type IProject } from 'n8nac';
import { type YagrConfigStoreLike, type YagrLlmProxyConfig, type YagrTelegramLinkedChat } from '../config/yagr-config-service.js';
import { type YagrModelProvider } from '../llm/provider-registry.js';
import type { GatewaySurface } from '../gateway/types.js';
import { type YagrSetupStatus } from './status.js';
type N8nProjectClient = Pick<N8nApiClient, 'testConnection' | 'getProjects'>;
interface SetupApplicationServiceDependencies {
    createN8nClient?: (credentials: {
        host: string;
        apiKey: string;
    }) => N8nProjectClient;
    ensureWorkspaceFiles?: (workflowDir: string) => void;
    refreshAiContext?: (credentials: {
        host: string;
        apiKey: string;
    }) => Promise<void>;
    resolveTelegramIdentity?: (botToken: string) => Promise<{
        username: string;
        firstName: string;
    }>;
    createOnboardingToken?: () => string;
    fetchAvailableModels?: (provider: YagrModelProvider, apiKey?: string, baseUrl?: string) => Promise<string[]>;
}
interface YagrN8nConfigStoreLike {
    getLocalConfig(): {
        host?: string;
        syncFolder?: string;
        projectId?: string;
        projectName?: string;
        instanceIdentifier?: string;
        customNodesPath?: string;
        instanceProfile?: 'yagr-managed-docker' | 'yagr-managed-direct' | 'custom-local-docker' | 'custom-local-direct' | 'custom-cloud';
    };
    getApiKey(host: string): string | undefined;
    saveApiKey(host: string, apiKey: string): void;
    saveBootstrapState(host: string, syncFolder?: string, instanceProfile?: 'yagr-managed-docker' | 'yagr-managed-direct' | 'custom-local-docker' | 'custom-local-direct' | 'custom-cloud'): void;
    getOrCreateInstanceIdentifier(host: string): Promise<string>;
    /** Optional: mirrors API key into n8nac CLI instanceProfiles so subprocesses authenticate. */
    syncN8nacCliApiKey?(): void;
    saveLocalConfig(config: {
        host?: string;
        syncFolder?: string;
        projectId?: string;
        projectName?: string;
        instanceIdentifier?: string;
        customNodesPath?: string;
        instanceProfile?: 'yagr-managed-docker' | 'yagr-managed-direct' | 'custom-local-docker' | 'custom-local-direct' | 'custom-cloud';
    }): void;
}
export declare class YagrSetupApplicationService {
    private readonly yagrConfigService;
    private readonly n8nConfigService;
    private readonly createN8nClient;
    private readonly ensureWorkspaceFiles;
    private readonly refreshAiContextRunner;
    private readonly resolveTelegramIdentity;
    private readonly createOnboardingToken;
    private readonly fetchAvailableModelsRunner;
    constructor(yagrConfigService: YagrConfigStoreLike, n8nConfigService: YagrN8nConfigStoreLike, dependencies?: SetupApplicationServiceDependencies);
    getLlmDefaults(): {
        provider: YagrModelProvider | undefined;
        reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
        getApiKey: (prov: YagrModelProvider) => string | undefined;
        getDefaultModel: (prov: YagrModelProvider) => string | undefined;
        getBaseUrl: (prov: YagrModelProvider) => string | undefined;
        needsBaseUrl: (prov: YagrModelProvider) => boolean;
    };
    prepareProvider(provider: YagrModelProvider, apiKey?: string, baseUrl?: string): Promise<{
        ready: boolean;
        apiKey: string | undefined;
        baseUrl: string | undefined;
        models: string[] | undefined;
        notes: string[];
        error: string | undefined;
    }>;
    hasAccountSession(provider: YagrModelProvider): Promise<boolean>;
    startAccountAuth(provider: YagrModelProvider): Promise<{
        kind: "input";
        title: string;
        instructions: string[];
        placeholder: string;
        submitLabel: string;
        state?: undefined;
    } | {
        kind: "input";
        title: string;
        instructions: string[];
        placeholder: string;
        submitLabel: string;
        state: string;
    } | {
        kind: "none";
        title?: undefined;
        instructions?: undefined;
        placeholder?: undefined;
        submitLabel?: undefined;
        state?: undefined;
    }>;
    completeAccountAuth(provider: YagrModelProvider, input: string, state?: string): Promise<{
        ok: boolean;
        apiKey: string;
        error?: undefined;
    } | {
        ok: boolean;
        error: string;
        apiKey?: undefined;
    } | {
        ok: boolean;
        apiKey?: undefined;
        error?: undefined;
    }>;
    fetchModels(provider: YagrModelProvider, apiKey?: string, baseUrlOverride?: string): Promise<string[]>;
    fetchModelsForSelection(input: {
        provider: YagrModelProvider;
        apiKey?: string;
        baseUrl?: string;
        requiresApiKey: (provider: YagrModelProvider) => boolean;
    }): Promise<string[]>;
    getSetupStatus(options?: {
        activeSurfaces?: GatewaySurface[];
    }): YagrSetupStatus;
    getSelectedN8nProjectId(): string | undefined;
    getTelegramStatus(): {
        configured: boolean;
        botUsername?: string;
        linkedChats: YagrTelegramLinkedChat[];
        deepLink?: string;
    };
    getTelegramRuntimeConfig(overrideBotToken?: string): {
        status: {
            configured: boolean;
            botUsername?: string;
            linkedChats: YagrTelegramLinkedChat[];
            deepLink?: string;
        };
        botToken?: string;
        onboardingToken?: string;
    };
    buildWebUiSnapshot(input: {
        activeSurfaces: GatewaySurface[];
        webUiStatus: {
            configured: boolean;
            host: string;
            port: number;
            url: string;
        };
        selectableProviders: YagrModelProvider[];
    }): Promise<Record<string, unknown>>;
    saveLlmConfig(input: {
        provider: YagrModelProvider;
        apiKey?: string;
        model: string;
        baseUrl?: string;
        reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    }): void;
    saveResolvedCliModelSelection(input: {
        provider: YagrModelProvider;
        model: string;
        baseUrl?: string;
        apiKey?: string;
        reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    }): void;
    resetYagrConfig(): void;
    getSurfaceDefaults(): {
        surfaces: GatewaySurface[];
    };
    getTelegramToken(): string | undefined;
    setupTelegram(token: string): Promise<{
        username: string;
        firstName: string;
    }>;
    saveSurfaces(input: {
        surfaces: GatewaySurface[];
        telegram?: {
            token: string;
            username: string;
        };
    }): void;
    setupLlmProxy(n8nUrl: string, instanceProfile?: 'yagr-managed-docker' | 'yagr-managed-direct' | 'custom-local-docker' | 'custom-local-direct' | 'custom-cloud'): Promise<{
        mode: YagrLlmProxyConfig['mode'];
        credentialBaseUrl: string;
        dockerHostAddress?: string;
        llmTunnelUrl?: string;
    }>;
    private startCloudflareTunnel;
    saveLlmProxyConfig(config: YagrLlmProxyConfig): void;
    provisionLlmProxyCredential(): Promise<void>;
    isLlmProxyEnabled(): boolean;
    configureTelegram(botToken: string): Promise<{
        username: string;
        firstName: string;
    }>;
    resetTelegram(): void;
    getLinkedTelegramChats(): YagrTelegramLinkedChat[];
    isTelegramChatLinked(chatId: string): boolean;
    linkTelegramChat(chat: YagrTelegramLinkedChat): void;
    unlinkTelegramChat(chatId: string): void;
    touchTelegramChat(chatId: string, userId?: number, username?: string, firstName?: string): void;
    fetchN8nProjects(host: string, apiKeyOverride?: string): Promise<IProject[]>;
    completeManagedN8nConnection(input: {
        host: string;
        apiKey: string;
        syncFolder?: string;
        instanceProfile?: 'yagr-managed-docker' | 'yagr-managed-direct' | 'custom-local-docker' | 'custom-local-direct' | 'custom-cloud';
    }): Promise<{
        project: IProject;
        warning?: string;
    }>;
    saveN8nConfig(input: {
        host: string;
        apiKey?: string;
        projectId: string;
        syncFolder: string;
        instanceProfile?: 'yagr-managed-docker' | 'yagr-managed-direct' | 'custom-local-docker' | 'custom-local-direct' | 'custom-cloud';
    }): Promise<string | undefined>;
    private selectManagedConnectionProject;
    private persistConnectedN8nConfig;
    refreshN8nWorkspaceInstructionsFromSavedConfig(): Promise<boolean>;
}
export declare function refreshAiContext(credentials: {
    host: string;
    apiKey: string;
}): Promise<void>;
export {};
//# sourceMappingURL=application-services.d.ts.map