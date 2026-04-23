import type { N8nTunnelConfig } from '../config/yagr-config-service.js';
import { YagrN8nConfigService, type YagrN8nInstanceProfile } from '../config/n8n-config-service.js';
import { type ManagedN8nInstanceState } from './state.js';
export type N8nInstanceTag = 'YAGR_MANAGED' | 'DOCKER' | 'CLOUD';
export type N8nInstanceKind = 'unconfigured' | 'yagr-managed-local' | 'local' | 'cloud';
export interface N8nInstanceCapabilities {
    supportsManagedTunnel: boolean;
    requiresLlmProxyTunnel: boolean;
    shouldProvisionYagrLlmProxy: boolean;
    shouldAutoStartManagedRuntime: boolean;
}
export interface N8nInstanceClassification {
    kind: N8nInstanceKind;
    host?: string;
    instanceProfile?: YagrN8nInstanceProfile;
    tags: N8nInstanceTag[];
    managedState?: ManagedN8nInstanceState;
    capabilities: N8nInstanceCapabilities;
}
export declare function normalizeN8nUrlOrigin(url: string | undefined): string | undefined;
export declare function doesConfiguredHostReferenceManagedRuntime(input: {
    host?: string;
    managedState?: ManagedN8nInstanceState;
    tunnelConfig?: N8nTunnelConfig;
}): boolean;
export declare function isLocalN8nUrl(urlString: string | undefined): boolean;
export declare function resolveN8nInstanceProfile(input: {
    host?: string;
    instanceProfile?: YagrN8nInstanceProfile;
    managedState?: ManagedN8nInstanceState;
    tunnelConfig?: N8nTunnelConfig;
}): YagrN8nInstanceProfile | undefined;
export declare function classifyN8nInstanceCandidate(input: {
    host?: string;
    instanceProfile?: YagrN8nInstanceProfile;
    managedState?: ManagedN8nInstanceState;
}): N8nInstanceClassification;
export declare function classifyConfiguredN8nInstance(configService?: Pick<YagrN8nConfigService, 'getLocalConfig'>): N8nInstanceClassification;
export declare function hasN8nInstanceTag(classification: Pick<N8nInstanceClassification, 'tags'>, tag: N8nInstanceTag): boolean;
//# sourceMappingURL=instance-classification.d.ts.map