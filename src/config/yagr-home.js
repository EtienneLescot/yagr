import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const initialLaunchDir = process.env.YAGR_LAUNCH_CWD ?? process.cwd();
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
export function getActiveMemorySourcePaths(memorySources) {
    const filePath = memorySources ?? path.join(getYagrHomeDir(), 'memory-sources.json');
    const data = readMemorySourcesFile(filePath);
    const candidates = (data.contexts ?? []).filter((p) => typeof p === 'string' && p.length > 0);
    return candidates.filter((p) => fs.existsSync(p));
}
export function registerContextMemorySource(absolutePath, memorySources) {
    const filePath = memorySources ?? path.join(getYagrHomeDir(), 'memory-sources.json');
    const data = readMemorySourcesFile(filePath);
    const contexts = data.contexts ?? [];
    if (contexts.includes(absolutePath))
        return;
    writeMemorySourcesFile(filePath, { ...data, contexts: [...contexts, absolutePath] });
}
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
    const proxyRuntimeDir = getYagrProxyRuntimeDir();
    const accountAuthDir = getYagrAccountAuthDir();
    const deepAgentSessionsDir = getYagrDeepAgentSessionsDir();
    return {
        launchDir,
        homeDir,
        proxyRuntimeDir,
        accountAuthDir,
        deepAgentSessionsDir,
        memorySources: path.join(homeDir, 'memory-sources.json'),
        yagrConfigPath: path.join(homeDir, 'yagr-config.json'),
        yagrCredentialsPath: path.join(homeDir, 'credentials.json'),
        proxyRuntimeStatePath: path.join(proxyRuntimeDir, 'state.json'),
        localOpenBridgeStatePath: path.join(proxyRuntimeDir, 'local-open-bridge.json'),
    };
}
export function ensureYagrHomeDir() {
    const paths = getYagrPaths();
    fs.mkdirSync(paths.homeDir, { recursive: true });
    fs.mkdirSync(paths.proxyRuntimeDir, { recursive: true });
    fs.mkdirSync(paths.accountAuthDir, { recursive: true });
    fs.mkdirSync(paths.deepAgentSessionsDir, { recursive: true });
    return paths.homeDir;
}
//# sourceMappingURL=yagr-home.js.map