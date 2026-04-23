export interface YagrPaths {
    launchDir: string;
    homeDir: string;
    n8nWorkspaceDir: string;
    managedN8nDir: string;
    proxyRuntimeDir: string;
    accountAuthDir: string;
    deepAgentSessionsDir: string;
    workspaceInstructionsPath: string;
    memorySources: string;
    yagrConfigPath: string;
    yagrCredentialsPath: string;
    proxyRuntimeStatePath: string;
    n8nRelayStatePath: string;
    llmTunnelStatePath: string;
    n8nAuthTunnelStatePath: string;
    localOpenBridgeStatePath: string;
    n8nConfigPath: string;
    n8nCredentialsPath: string;
}
export declare function resolveBundledManagerInstructionsPath(launchDir?: string): string | undefined;
/**
 * Returns all active memory source paths in load order:
 *   1. core (manager instructions)
 *   2. registered contexts (e.g. n8n-workspace/AGENTS.md)
 * Only paths that exist on disk are returned.
 */
export declare function getActiveMemorySourcePaths(memorySources?: string): string[];
/**
 * Register or update the core manager instructions source.
 * Called on every startup from ensureYagrHomeDir so the path
 * stays current after package updates.
 */
export declare function registerCoreMemorySource(absolutePath: string, memorySources?: string): void;
/**
 * Register a workspace context file (e.g. n8n-workspace/AGENTS.md).
 * Idempotent: calling it twice with the same path is a no-op.
 */
export declare function registerContextMemorySource(absolutePath: string, memorySources?: string): void;
export declare function getYagrLaunchDir(): string;
export declare function resolveYagrHomeDir(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, homedir?: string, launchDir?: string): string;
export declare function getYagrHomeDir(): string;
export declare function getYagrN8nWorkspaceDir(): string;
export declare function getYagrManagedN8nDir(): string;
export declare function getYagrProxyRuntimeDir(): string;
export declare function getYagrAccountAuthDir(): string;
export declare function getYagrSessionsDir(): string;
export declare function getYagrMemoriesDir(): string;
export declare function getYagrDeepAgentSessionsDir(): string;
export declare function getYagrPaths(): YagrPaths;
export declare function ensureYagrHomeDir(): string;
//# sourceMappingURL=yagr-home.d.ts.map