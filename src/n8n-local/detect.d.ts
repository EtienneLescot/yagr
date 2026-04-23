export declare const DEFAULT_N8N_PORT = 5678;
export declare const MAX_PORT_SCAN_ATTEMPTS = 10;
export declare const MINIMUM_DIRECT_RUNTIME_NODE_VERSION = "22.16.0";
export type LocalN8nBootstrapStrategy = 'docker' | 'direct' | 'manual';
export interface CommandAvailability {
    available: boolean;
    version?: string;
    reachable?: boolean;
    statusMessage?: string;
}
export interface LocalN8nBootstrapAssessment {
    platform: NodeJS.Platform;
    docker: CommandAvailability;
    node: CommandAvailability & {
        supportedForDirectRuntime: boolean;
        majorVersion?: number;
    };
    preferredPort: number;
    preferredUrl: string;
    recommendedStrategy: LocalN8nBootstrapStrategy;
    blockers: string[];
    notes: string[];
}
interface DetectDependencies {
    platform: NodeJS.Platform;
    detectCommand(command: string, versionArgs: string[]): Promise<CommandAvailability>;
    isPortAvailable(port: number): Promise<boolean>;
}
export declare function normalizeCommandVersion(output: string | undefined): string | undefined;
export declare function parseNodeMajorVersion(version: string | undefined): number | undefined;
export declare function parseNodeVersion(version: string | undefined): {
    major: number;
    minor: number;
    patch: number;
} | undefined;
export declare function isSupportedDirectRuntimeNodeVersion(version: string | undefined): boolean;
export declare function chooseLocalN8nBootstrapStrategy(input: {
    dockerAvailable: boolean;
    nodeVersion?: string;
}): LocalN8nBootstrapStrategy;
export declare function buildLocalN8nBootstrapAssessment(input: {
    platform: NodeJS.Platform;
    docker: CommandAvailability;
    node: CommandAvailability;
    preferredPort: number;
}): LocalN8nBootstrapAssessment;
export declare function formatLocalN8nBootstrapAssessment(assessment: LocalN8nBootstrapAssessment): string;
export declare function inspectLocalN8nBootstrap(dependencies?: Partial<DetectDependencies>): Promise<LocalN8nBootstrapAssessment>;
export {};
//# sourceMappingURL=detect.d.ts.map