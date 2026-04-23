import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { YagrSetupApplicationService } from '../setup/application-services.js';
import { bootstrapManagedLocalN8n } from './bootstrap.js';
import { getManagedDirectN8nStatus, installManagedDirectN8n, startManagedDirectN8n, } from './direct-manager.js';
import { getManagedDockerN8nStatus, installManagedDockerN8n, startManagedDockerN8n, } from './docker-manager.js';
import { markManagedN8nBootstrapStage, resolveManagedN8nBootstrapStage } from './state.js';
import { classifyConfiguredN8nInstance, doesConfiguredHostReferenceManagedRuntime, normalizeN8nUrlOrigin, resolveN8nInstanceProfile } from './instance-classification.js';
import { resolveN8nRuntimeState } from '../config/n8n-config-service.js';
function syncConfiguredHostWithTunnelUrl(configService) {
    const tunnelConfig = new YagrConfigService().getN8nTunnelConfig();
    if (!tunnelConfig?.enabled || !tunnelConfig.publicUrl) {
        return;
    }
    const syncableConfigService = configService;
    if (typeof syncableConfigService.syncN8nacHostUrl === 'function') {
        syncableConfigService.syncN8nacHostUrl(tunnelConfig.publicUrl);
    }
}
function resolveConfiguredRuntimeMode(configService) {
    syncConfiguredHostWithTunnelUrl(configService);
    const localConfig = configService.getLocalConfig();
    const classification = classifyConfiguredN8nInstance(configService);
    if (!localConfig.host) {
        return {
            source: 'unconfigured',
            localConfig,
            managedState: classification.managedState,
        };
    }
    return {
        source: classification.kind === 'yagr-managed-local'
            ? 'yagr-managed-local'
            : classification.kind === 'local'
                ? 'local'
                : 'cloud',
        localConfig,
        managedState: classification.managedState,
    };
}
export function getConfiguredManagedN8nState(configService = new YagrN8nConfigService()) {
    return resolveConfiguredRuntimeMode(configService).managedState;
}
export async function ensureConfiguredManagedN8nRunning(configService = new YagrN8nConfigService(), dependencies = {}) {
    const getDirectStatus = dependencies.getDirectStatus ?? getManagedDirectN8nStatus;
    const startDirect = dependencies.startDirect ?? startManagedDirectN8n;
    const installDirect = dependencies.installDirect ?? installManagedDirectN8n;
    const getDockerStatus = dependencies.getDockerStatus ?? getManagedDockerN8nStatus;
    const startDocker = dependencies.startDocker ?? startManagedDockerN8n;
    const installDocker = dependencies.installDocker ?? installManagedDockerN8n;
    const localConfig = configService.getLocalConfig();
    const tunnelConfig = new YagrConfigService().getN8nTunnelConfig();
    const classification = classifyConfiguredN8nInstance(configService);
    const managedState = getConfiguredManagedN8nState(configService);
    const recovery = resolveManagedRuntimeRecovery(localConfig, classification.instanceProfile, tunnelConfig);
    const compatibleManagedState = isManagedStateCompatibleWithConfig(managedState, classification.instanceProfile, localConfig.host, tunnelConfig)
        ? managedState
        : undefined;
    if (compatibleManagedState?.strategy === 'direct') {
        const status = await getDirectStatus();
        if (status.running && status.healthy && status.state) {
            return { state: status.state, started: false };
        }
        return { state: await startDirect(), started: true };
    }
    if (compatibleManagedState?.strategy === 'docker') {
        const status = await getDockerStatus();
        if (status.running && status.healthy && status.state) {
            return { state: status.state, started: false };
        }
        return { state: await startDocker(), started: true };
    }
    if (!recovery) {
        return { started: false };
    }
    if (recovery.strategy === 'direct') {
        return { state: await installDirect({ port: recovery.port }), started: true };
    }
    return { state: await installDocker({ port: recovery.port }), started: true };
}
export async function getConfiguredExternalN8nReachabilityWarning(configService = new YagrN8nConfigService()) {
    const { source, localConfig } = resolveConfiguredRuntimeMode(configService);
    if (source !== 'local' && source !== 'cloud') {
        return undefined;
    }
    if (!localConfig.host) {
        return undefined;
    }
    try {
        const response = await fetch(new URL('/healthz', localConfig.host), {
            method: 'GET',
        });
        if (response.ok) {
            return undefined;
        }
    }
    catch {
        // Fall through to the same warning message.
    }
    return `Configured external n8n instance is not reachable at ${localConfig.host}. Yagr will not restart manually-managed instances automatically.`;
}
export async function prepareConfiguredN8nForLaunch(configService = new YagrN8nConfigService(), dependencies = {}) {
    const { source } = resolveConfiguredRuntimeMode(configService);
    const ensureManagedRunning = dependencies.ensureManagedRunning ?? ensureConfiguredManagedN8nRunning;
    const bootstrapManaged = dependencies.bootstrapManaged ?? (async (url) => bootstrapManagedLocalN8n({ url }));
    const setupServiceFactory = dependencies.setupServiceFactory
        ?? ((resolvedConfigService) => new YagrSetupApplicationService(new YagrConfigService(), resolvedConfigService));
    if (source === 'yagr-managed-local') {
        const ensured = await ensureManagedRunning(configService);
        const reconciliation = ensured.state
            ? await reconcileManagedN8nAtLaunch(ensured.state, configService, {
                bootstrapManaged,
                setupService: setupServiceFactory(configService),
            })
            : { reconciled: false };
        return {
            mode: source,
            started: ensured.started,
            reconciled: reconciliation.reconciled,
            state: ensured.state,
            warning: reconciliation.warning,
        };
    }
    if (source === 'local' || source === 'cloud') {
        return {
            mode: source,
            started: false,
            reconciled: false,
            warning: await getConfiguredExternalN8nReachabilityWarning(configService),
        };
    }
    return {
        mode: source,
        started: false,
        reconciled: false,
    };
}
function resolveManagedRuntimeRecovery(localConfig, instanceProfile, tunnelConfig) {
    if (instanceProfile !== 'yagr-managed-docker' && instanceProfile !== 'yagr-managed-direct') {
        return undefined;
    }
    const configuredOrigin = normalizeN8nUrlOrigin(localConfig.host);
    const tunnelPublicOrigin = normalizeN8nUrlOrigin(tunnelConfig?.publicUrl);
    const hostForPort = configuredOrigin && tunnelPublicOrigin && configuredOrigin === tunnelPublicOrigin
        ? tunnelConfig?.targetUrl
        : localConfig.host;
    return {
        strategy: instanceProfile === 'yagr-managed-docker' ? 'docker' : 'direct',
        port: resolvePortFromN8nUrl(hostForPort),
    };
}
function isManagedStateCompatibleWithConfig(managedState, instanceProfile, host, tunnelConfig) {
    if (!managedState) {
        return false;
    }
    if (instanceProfile === 'yagr-managed-docker' && managedState.strategy !== 'docker') {
        return false;
    }
    if (instanceProfile === 'yagr-managed-direct' && managedState.strategy !== 'direct') {
        return false;
    }
    if (!doesConfiguredHostReferenceManagedRuntime({ host, managedState, tunnelConfig })) {
        return false;
    }
    return true;
}
function resolvePortFromN8nUrl(url) {
    if (!url) {
        return undefined;
    }
    try {
        const parsed = new URL(url);
        return parsed.port ? Number(parsed.port) : undefined;
    }
    catch {
        return undefined;
    }
}
async function reconcileManagedN8nAtLaunch(state, configService, dependencies) {
    if (resolveManagedN8nBootstrapStage(state.url) === 'connected') {
        return { reconciled: false };
    }
    const currentConfig = configService.getLocalConfig();
    const runtimeState = resolveN8nRuntimeState(configService);
    const configuredOrigin = normalizeN8nUrlOrigin(runtimeState.host);
    const managedOrigin = normalizeN8nUrlOrigin(state.url);
    const storedApiKey = configuredOrigin && managedOrigin && configuredOrigin === managedOrigin
        ? runtimeState.apiKey
        : undefined;
    const instanceProfile = currentConfig.instanceProfile ?? resolveN8nInstanceProfile({
        host: state.url,
        managedState: state,
    });
    try {
        if (storedApiKey) {
            const result = await dependencies.setupService.completeManagedN8nConnection({
                host: state.url,
                apiKey: storedApiKey,
                syncFolder: currentConfig.syncFolder,
                instanceProfile,
            });
            markManagedN8nBootstrapStage(state.url, 'connected');
            return { reconciled: true, warning: result.warning };
        }
    }
    catch {
        // Fall back to a fresh silent bootstrap to recover from stale credentials.
    }
    const bootstrap = await dependencies.bootstrapManaged(state.url);
    if (!bootstrap.apiKey) {
        throw new Error(`Managed n8n startup reconciliation could not complete silently: ${bootstrap.reason ?? 'bootstrap did not return an API key'}`);
    }
    const result = await dependencies.setupService.completeManagedN8nConnection({
        host: state.url,
        apiKey: bootstrap.apiKey,
        syncFolder: currentConfig.syncFolder,
        instanceProfile,
    });
    markManagedN8nBootstrapStage(state.url, 'connected');
    return { reconciled: true, warning: result.warning };
}
//# sourceMappingURL=managed-runtime.js.map