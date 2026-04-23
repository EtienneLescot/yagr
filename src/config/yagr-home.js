import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const initialLaunchDir = process.env.YAGR_LAUNCH_CWD ?? process.cwd();
// ---------------------------------------------------------------------------
// Bundled manager instructions path resolution
// ---------------------------------------------------------------------------
export function resolveBundledManagerInstructionsPath(launchDir = getYagrLaunchDir()) {
    const candidates = [
        fileURLToPath(new URL('../manager-tooling/YAGENTS.md', import.meta.url)),
        fileURLToPath(new URL('../src/manager-tooling/YAGENTS.md', import.meta.url)),
        path.join(launchDir, 'node_modules', '@yagr', 'manager-tooling', 'YAGENTS.md'),
        path.join(launchDir, 'src', 'manager-tooling', 'YAGENTS.md'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}
function readMemorySourcesFile(memorySources) {
    try {
        if (!fs.existsSync(memorySources))
            return {};
        const raw = fs.readFileSync(memorySources, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
        return {};
    }
    catch {
        return {};
    }
}
function writeMemorySourcesFile(memorySources, data) {
    try {
        fs.writeFileSync(memorySources, JSON.stringify(data, null, 2));
    }
    catch {
        // Best effort only.
    }
}
/**
 * Returns all active memory source paths in load order:
 *   1. core (manager instructions)
 *   2. registered contexts (e.g. n8n-workspace/AGENTS.md)
 * Only paths that exist on disk are returned.
 */
export function getActiveMemorySourcePaths(memorySources) {
    const filePath = memorySources ?? path.join(getYagrHomeDir(), 'memory-sources.json');
    const data = readMemorySourcesFile(filePath);
    const candidates = [
        data.core,
        ...(data.contexts ?? []),
    ].filter((p) => typeof p === 'string' && p.length > 0);
    return candidates.filter((p) => fs.existsSync(p));
}
/**
 * Register or update the core manager instructions source.
 * Called on every startup from ensureYagrHomeDir so the path
 * stays current after package updates.
 */
export function registerCoreMemorySource(absolutePath, memorySources) {
    const filePath = memorySources ?? path.join(getYagrHomeDir(), 'memory-sources.json');
    const data = readMemorySourcesFile(filePath);
    if (data.core === absolutePath)
        return;
    writeMemorySourcesFile(filePath, { ...data, core: absolutePath });
}
/**
 * Register a workspace context file (e.g. n8n-workspace/AGENTS.md).
 * Idempotent: calling it twice with the same path is a no-op.
 */
export function registerContextMemorySource(absolutePath, memorySources) {
    const filePath = memorySources ?? path.join(getYagrHomeDir(), 'memory-sources.json');
    const data = readMemorySourcesFile(filePath);
    const contexts = data.contexts ?? [];
    if (contexts.includes(absolutePath))
        return;
    writeMemorySourcesFile(filePath, { ...data, contexts: [...contexts, absolutePath] });
}
// ---------------------------------------------------------------------------
if (!process.env.YAGR_LAUNCH_CWD) {
    process.env.YAGR_LAUNCH_CWD = initialLaunchDir;
}
export function getYagrLaunchDir() {
    return process.env.YAGR_LAUNCH_CWD ?? initialLaunchDir;
}
export function resolveYagrHomeDir(env = process.env, platform = process.platform, homedir = os.homedir(), launchDir = getYagrLaunchDir()) {
    const configuredHome = env.YAGR_HOME?.trim();
    if (configuredHome) {
        return path.isAbsolute(configuredHome)
            ? configuredHome
            : path.resolve(launchDir, configuredHome);
    }
    if (platform === 'win32') {
        const appDataDir = env.APPDATA?.trim();
        if (appDataDir) {
            return path.join(appDataDir, 'yagr');
        }
        return path.join(homedir, 'AppData', 'Roaming', 'yagr');
    }
    return path.join(homedir, '.yagr');
}
export function getYagrHomeDir() {
    return resolveYagrHomeDir(process.env, process.platform, os.homedir(), getYagrLaunchDir());
}
export function getYagrN8nWorkspaceDir() {
    return path.join(getYagrHomeDir(), 'n8n-workspace');
}
export function getYagrManagedN8nDir() {
    return path.join(getYagrHomeDir(), 'n8n');
}
export function getYagrProxyRuntimeDir() {
    return path.join(getYagrHomeDir(), 'proxy-runtime');
}
export function getYagrAccountAuthDir() {
    return path.join(getYagrHomeDir(), 'oauth');
}
export function getYagrSessionsDir() {
    return path.join(getYagrHomeDir(), 'sessions');
}
export function getYagrMemoriesDir() {
    return path.join(getYagrHomeDir(), 'memories');
}
export function getYagrDeepAgentSessionsDir() {
    return path.join(getYagrHomeDir(), 'deepagent-sessions');
}
export function getYagrPaths() {
    const launchDir = getYagrLaunchDir();
    const homeDir = getYagrHomeDir();
    const n8nWorkspaceDir = getYagrN8nWorkspaceDir();
    const managedN8nDir = getYagrManagedN8nDir();
    const proxyRuntimeDir = getYagrProxyRuntimeDir();
    const accountAuthDir = getYagrAccountAuthDir();
    const deepAgentSessionsDir = getYagrDeepAgentSessionsDir();
    return {
        launchDir,
        homeDir,
        n8nWorkspaceDir,
        managedN8nDir,
        proxyRuntimeDir,
        accountAuthDir,
        deepAgentSessionsDir,
        workspaceInstructionsPath: path.join(n8nWorkspaceDir, 'AGENTS.md'),
        memorySources: path.join(homeDir, 'memory-sources.json'),
        yagrConfigPath: path.join(homeDir, 'yagr-config.json'),
        yagrCredentialsPath: path.join(homeDir, 'credentials.json'),
        proxyRuntimeStatePath: path.join(proxyRuntimeDir, 'state.json'),
        n8nRelayStatePath: path.join(proxyRuntimeDir, 'llm-relay.json'),
        llmTunnelStatePath: path.join(proxyRuntimeDir, 'llm-tunnel.json'),
        n8nAuthTunnelStatePath: path.join(proxyRuntimeDir, 'n8n-auth-tunnel.json'),
        localOpenBridgeStatePath: path.join(proxyRuntimeDir, 'local-open-bridge.json'),
        n8nConfigPath: path.join(n8nWorkspaceDir, 'n8nac-config.json'),
        n8nCredentialsPath: path.join(homeDir, 'n8n-credentials.json'),
    };
}
export function ensureYagrHomeDir() {
    const paths = getYagrPaths();
    fs.mkdirSync(paths.homeDir, { recursive: true });
    fs.mkdirSync(paths.n8nWorkspaceDir, { recursive: true });
    fs.mkdirSync(paths.managedN8nDir, { recursive: true });
    fs.mkdirSync(paths.proxyRuntimeDir, { recursive: true });
    fs.mkdirSync(paths.accountAuthDir, { recursive: true });
    fs.mkdirSync(paths.deepAgentSessionsDir, { recursive: true });
    return paths.homeDir;
}
//# sourceMappingURL=yagr-home.js.map