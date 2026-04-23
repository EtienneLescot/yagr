export type YagrN8nInstanceProfile = 'yagr-managed-docker' | 'yagr-managed-direct' | 'custom-local-docker' | 'custom-local-direct' | 'custom-cloud';
export interface YagrN8nLocalConfig {
    host?: string;
    syncFolder?: string;
    projectId?: string;
    projectName?: string;
    instanceIdentifier?: string;
    customNodesPath?: string;
    instanceProfile?: YagrN8nInstanceProfile;
}
export interface YagrResolvedN8nRuntimeState {
    host?: string;
    apiKey?: string;
    syncFolder?: string;
    projectId?: string;
    projectName?: string;
    instanceIdentifier?: string;
    workflowDir?: string;
    credentialsAvailable: boolean;
    projectConfigured: boolean;
    initialized: boolean;
}
export interface ResolveN8nRuntimeStateOptions {
    allowEnvironmentFallback?: boolean;
}
/**
 * Computes the fully-qualified workflow directory for the current config:
 *   <syncFolder>/<instanceIdentifier>/<projectSlug>
 *
 * Returns undefined when any required field is missing (e.g. during bootstrap).
 * This is the single source of truth for this path calculation.
 */
export declare function resolveWorkflowDir(config: YagrN8nLocalConfig): string | undefined;
export declare function resolveN8nRuntimeState(configService: Pick<YagrN8nConfigService, 'getLocalConfig' | 'getApiKey'>, env?: NodeJS.ProcessEnv, options?: ResolveN8nRuntimeStateOptions): YagrResolvedN8nRuntimeState;
export declare class YagrN8nConfigService {
    private readonly globalStore;
    private readonly compatibilityStore;
    private readonly localConfigPath;
    constructor();
    getLocalConfig(): YagrN8nLocalConfig;
    saveLocalConfig(config: YagrN8nLocalConfig): void;
    saveBootstrapState(host: string, syncFolder?: string, instanceProfile?: YagrN8nLocalConfig['instanceProfile']): void;
    getApiKey(host: string): string | undefined;
    saveApiKey(host: string, apiKey: string): void;
    /**
     * n8nac resolves API keys with instanceProfiles[activeInstanceId] before hosts[].
     * Yagr only wrote `hosts`, so a stale per-instance secret (e.g. from an older CLI init)
     * could shadow the current key and make `npx n8nac credential …` return 401.
     * Mirror the active instance key into n8nac's ConfigService store.
     */
    syncN8nacCliApiKey(): void;
    /**
     * When a Cloudflare tunnel is active for a Yagr-managed n8n instance, the
     * n8nac workspace host URL needs to be updated so that webhook URLs
     * constructed by n8nac (which uses the configured host, not n8n's reported URL)
     * are correct.
     *
     * For Yagr-managed instances the instance identifier stays stable as
     * `"yagr-managed"` — only the host URL changes to the tunnel public URL.
     *
     * Best effort: errors are silently ignored so tunnel issues don't block startup.
     */
    syncN8nacHostUrl(tunnelPublicUrl: string): void;
    clearLocalConfig(): void;
    clearAllApiKeys(): void;
    getOrCreateInstanceIdentifier(host: string): Promise<string>;
    private normalizeHost;
    private readRawLocalConfig;
    private syncCompatibilityCredentials;
}
//# sourceMappingURL=n8n-config-service.d.ts.map