import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { type SilentManagedN8nBootstrapResult } from './bootstrap.js';
import { getManagedDirectN8nStatus, installManagedDirectN8n, startManagedDirectN8n } from './direct-manager.js';
import { getManagedDockerN8nStatus, installManagedDockerN8n, startManagedDockerN8n } from './docker-manager.js';
import type { ManagedN8nInstanceState } from './state.js';
export type ConfiguredN8nRuntimeMode = 'unconfigured' | 'yagr-managed-local' | 'local' | 'cloud';
export interface ConfiguredN8nLaunchPreparation {
    mode: ConfiguredN8nRuntimeMode;
    started: boolean;
    reconciled: boolean;
    state?: ManagedN8nInstanceState;
    warning?: string;
}
interface ManagedLaunchDependencies {
    ensureManagedRunning?: (configService: YagrN8nConfigService) => Promise<{
        state?: ManagedN8nInstanceState;
        started: boolean;
    }>;
    bootstrapManaged?: (url: string) => Promise<SilentManagedN8nBootstrapResult>;
    setupServiceFactory?: (configService: YagrN8nConfigService) => ManagedConnectionSetupService;
}
interface ManagedRuntimeDependencies {
    getDirectStatus?: typeof getManagedDirectN8nStatus;
    startDirect?: typeof startManagedDirectN8n;
    installDirect?: typeof installManagedDirectN8n;
    getDockerStatus?: typeof getManagedDockerN8nStatus;
    startDocker?: typeof startManagedDockerN8n;
    installDocker?: typeof installManagedDockerN8n;
}
interface ManagedConnectionSetupService {
    completeManagedN8nConnection(input: {
        host: string;
        apiKey: string;
        syncFolder?: string;
        instanceProfile?: ReturnType<YagrN8nConfigService['getLocalConfig']>['instanceProfile'];
    }): Promise<{
        warning?: string;
    }>;
}
export declare function getConfiguredManagedN8nState(configService?: YagrN8nConfigService): ManagedN8nInstanceState | undefined;
export declare function ensureConfiguredManagedN8nRunning(configService?: YagrN8nConfigService, dependencies?: ManagedRuntimeDependencies): Promise<{
    state?: ManagedN8nInstanceState;
    started: boolean;
}>;
export declare function getConfiguredExternalN8nReachabilityWarning(configService?: YagrN8nConfigService): Promise<string | undefined>;
export declare function prepareConfiguredN8nForLaunch(configService?: YagrN8nConfigService, dependencies?: ManagedLaunchDependencies): Promise<ConfiguredN8nLaunchPreparation>;
export {};
//# sourceMappingURL=managed-runtime.d.ts.map