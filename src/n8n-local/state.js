import fs from 'node:fs';
import path from 'node:path';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
import { classifyConfiguredN8nInstance, normalizeN8nUrlOrigin } from './instance-classification.js';
export function getManagedN8nPaths() {
    const { managedN8nDir } = getYagrPaths();
    return {
        rootDir: managedN8nDir,
        stateFile: path.join(managedN8nDir, 'instance.json'),
        composeFile: path.join(managedN8nDir, 'compose.yaml'),
        envFile: path.join(managedN8nDir, '.env'),
        dataDir: path.join(managedN8nDir, 'data'),
        logFile: path.join(managedN8nDir, 'runtime.log'),
    };
}
export function ensureManagedN8nDirs() {
    ensureYagrHomeDir();
    const paths = getManagedN8nPaths();
    fs.mkdirSync(paths.rootDir, { recursive: true });
    fs.mkdirSync(paths.dataDir, { recursive: true });
    return paths;
}
export function readManagedN8nState() {
    const { stateFile } = getManagedN8nPaths();
    if (!fs.existsSync(stateFile)) {
        return undefined;
    }
    try {
        return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    }
    catch {
        return undefined;
    }
}
export function writeManagedN8nState(state) {
    const paths = ensureManagedN8nDirs();
    fs.writeFileSync(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`);
    return state;
}
export function buildManagedN8nState(input) {
    const paths = ensureManagedN8nDirs();
    const now = new Date().toISOString();
    return {
        strategy: input.strategy ?? 'docker',
        image: input.image || undefined,
        port: input.port,
        url: `http://127.0.0.1:${input.port}`,
        composeFile: input.strategy === 'direct' ? undefined : paths.composeFile,
        envFile: input.strategy === 'direct' ? undefined : paths.envFile,
        dataDir: paths.dataDir,
        logFile: input.logFile ?? paths.logFile,
        pid: input.pid,
        status: input.status ?? 'created',
        bootstrapStage: input.bootstrapStage ?? 'runtime-only',
        createdAt: now,
        updatedAt: now,
        lastError: input.lastError,
    };
}
export function updateManagedN8nState(updater) {
    const current = readManagedN8nState();
    const next = updater(current);
    next.updatedAt = new Date().toISOString();
    if (!next.createdAt) {
        next.createdAt = next.updatedAt;
    }
    return writeManagedN8nState(next);
}
export function markManagedN8nBootstrapStage(url, bootstrapStage) {
    const current = readManagedN8nState();
    if (!current || current.url !== url) {
        return undefined;
    }
    return updateManagedN8nState((state) => ({
        ...(state ?? current),
        bootstrapStage,
        status: bootstrapStage === 'connected' ? 'ready' : (state ?? current).status,
        lastError: undefined,
    }));
}
export function resolveManagedN8nBootstrapStage(url) {
    const configService = new YagrN8nConfigService();
    const yagrConfigService = new YagrConfigService();
    const localConfig = configService.getLocalConfig();
    const classification = classifyConfiguredN8nInstance(configService);
    const configuredHost = normalizeN8nUrlOrigin(localConfig.host);
    const managedHost = normalizeN8nUrlOrigin(url);
    const tunnelConfig = yagrConfigService.getN8nTunnelConfig();
    const tunnelPublicOrigin = normalizeN8nUrlOrigin(tunnelConfig?.publicUrl);
    const tunnelTargetOrigin = normalizeN8nUrlOrigin(tunnelConfig?.targetUrl);
    const hostReferencesManagedRuntime = Boolean(configuredHost
        && managedHost
        && (configuredHost === managedHost
            || (tunnelConfig?.enabled && configuredHost === tunnelPublicOrigin && managedHost === tunnelTargetOrigin)));
    if (classification.kind === 'yagr-managed-local'
        && hostReferencesManagedRuntime
        && localConfig.projectId
        && localConfig.projectName
        && configService.getApiKey(localConfig.host ?? '')) {
        return 'connected';
    }
    return readManagedN8nState()?.bootstrapStage ?? 'owner-pending';
}
//# sourceMappingURL=state.js.map