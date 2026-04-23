import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_N8N_PORT, inspectLocalN8nBootstrap } from './detect.js';
import { resolvePackageManagerCommand, resolvePackageManagerSpawnOptions } from '../system/package-manager.js';
import { buildManagedN8nState, ensureManagedN8nDirs, readManagedN8nState, resolveManagedN8nBootstrapStage, updateManagedN8nState, } from './state.js';
import { getActiveTunnelState } from './n8n-tunnel.js';
const DEFAULT_HEALTH_TIMEOUT_MS = parseInt(process.env.YAGR_N8N_HEALTH_TIMEOUT_MS ?? '300000', 10);
const DEFAULT_STARTUP_TIMEOUT_MS = 600_000;
const DEFAULT_EDITOR_TIMEOUT_MS = 90_000;
const N8N_PACKAGE_SPEC = 'n8n@latest';
export async function installManagedDirectN8n(options = {}) {
    const assessment = await inspectLocalN8nBootstrap();
    if (!assessment.node.supportedForDirectRuntime) {
        throw new Error('A supported local Node.js runtime is required for direct n8n bootstrap. Run `yagr n8n doctor` for details.');
    }
    const paths = ensureManagedN8nDirs();
    const npmCacheDir = path.join(paths.rootDir, 'npm-cache');
    fs.mkdirSync(npmCacheDir, { recursive: true });
    const existingState = readManagedN8nState();
    const port = options.port ?? existingState?.port ?? assessment.preferredPort ?? DEFAULT_N8N_PORT;
    const bootstrapStage = resolveManagedN8nBootstrapStage(`http://127.0.0.1:${port}`);
    const state = updateManagedN8nState(() => buildManagedN8nState({
        strategy: 'direct',
        image: '',
        port,
        status: 'starting',
        bootstrapStage,
        logFile: paths.logFile,
    }));
    const child = spawn(resolvePackageManagerCommand('npm'), [
        'exec',
        '--yes',
        N8N_PACKAGE_SPEC,
        '--',
        'start',
    ], {
        cwd: paths.rootDir,
        detached: true,
        stdio: ['ignore', fs.openSync(paths.logFile, 'a'), fs.openSync(paths.logFile, 'a')],
        ...resolvePackageManagerSpawnOptions(),
        env: {
            ...process.env,
            N8N_PORT: String(port),
            N8N_HOST: '127.0.0.1',
            N8N_LISTEN_ADDRESS: '0.0.0.0',
            N8N_PROTOCOL: 'http',
            // When a tunnel is active, set the editor base URL to the tunnel public URL
            // so n8n doesn't require the Editor-Version header for IDE auth.
            N8N_EDITOR_BASE_URL: getActiveTunnelState()?.publicUrl ?? `http://127.0.0.1:${port}`,
            N8N_SECURE_COOKIE: 'false',
            N8N_USER_FOLDER: paths.dataDir,
            N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'true',
            GENERIC_TIMEZONE: 'UTC',
            TZ: 'UTC',
            npm_config_cache: npmCacheDir,
            npm_config_update_notifier: 'false',
            ...(getActiveTunnelState()?.publicUrl ? { N8N_WEBHOOK_URL: getActiveTunnelState().publicUrl } : {}),
        },
    });
    const startupWatch = waitForManagedN8nStartup(child, state.url, paths.logFile);
    child.unref();
    await startupWatch;
    await waitForManagedN8nEditorReadyBestEffort(state.url);
    return updateManagedN8nState((current) => ({
        ...(current ?? state),
        strategy: 'direct',
        port,
        url: state.url,
        logFile: paths.logFile,
        pid: child.pid,
        status: 'ready',
        bootstrapStage: current?.bootstrapStage ?? bootstrapStage,
        lastError: undefined,
    }));
}
export async function startManagedDirectN8n() {
    const state = readManagedN8nState();
    if (!state || state.strategy !== 'direct') {
        throw new Error('No Yagr-managed direct local n8n instance is installed yet. Run `yagr n8n local install` first.');
    }
    return installManagedDirectN8n({ port: state.port });
}
export async function stopManagedDirectN8n() {
    const state = readManagedN8nState();
    if (!state || state.strategy !== 'direct') {
        throw new Error('No Yagr-managed direct local n8n instance is installed yet.');
    }
    if (state.pid) {
        try {
            process.kill(state.pid, 'SIGTERM');
        }
        catch {
            // ignore missing process
        }
    }
    return updateManagedN8nState((current) => ({
        ...(current ?? state),
        status: 'stopped',
        lastError: undefined,
    }));
}
export async function getManagedDirectN8nLogs() {
    const state = readManagedN8nState();
    if (!state?.logFile || !fs.existsSync(state.logFile)) {
        return '';
    }
    return fs.readFileSync(state.logFile, 'utf-8');
}
export async function getManagedDirectN8nStatus() {
    const state = readManagedN8nState();
    if (!state || state.strategy !== 'direct') {
        return {
            installed: false,
            running: false,
            healthy: false,
        };
    }
    const running = isPidAlive(state.pid);
    const healthy = running ? await isManagedN8nHealthy(state.url) : false;
    return {
        installed: true,
        running,
        healthy,
        url: state.url,
        state,
    };
}
async function isManagedN8nHealthy(url) {
    try {
        const response = await fetch(`${url}/healthz`);
        return response.ok;
    }
    catch {
        return false;
    }
}
async function isManagedN8nEditorReady(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return false;
        }
        const body = await response.text();
        return body.trim().length > 0 && !body.toLowerCase().includes('n8n is starting up');
    }
    catch {
        return false;
    }
}
async function waitForManagedN8nHealth(url, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isManagedN8nHealthy(url)) {
            return;
        }
        await delay(1500);
    }
    throw new Error(`Timed out waiting for ${url} to become healthy.`);
}
async function waitForManagedN8nEditorReady(url, timeoutMs = DEFAULT_EDITOR_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isManagedN8nEditorReady(url)) {
            return;
        }
        await delay(1500);
    }
    throw new Error(`Timed out waiting for the n8n editor at ${url} to become ready.`);
}
async function waitForManagedN8nEditorReadyBestEffort(url) {
    try {
        await waitForManagedN8nEditorReady(url);
    }
    catch {
        // best effort only
    }
}
async function waitForManagedN8nStartup(child, url, logFile, timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS) {
    let childError;
    let exitCode;
    let exitSignal;
    let exited = false;
    child.once('error', (error) => {
        childError = error;
    });
    child.once('exit', (code, signal) => {
        exited = true;
        exitCode = code;
        exitSignal = signal;
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (childError) {
            throw new Error(`Failed to start managed n8n runtime: ${childError.message}`);
        }
        if (await isManagedN8nHealthy(url)) {
            return;
        }
        if (exited) {
            const logTail = readLogTail(logFile);
            const suffix = logTail ? `\n\nRecent runtime log:\n${logTail}` : '';
            throw new Error(`Managed n8n runtime exited before becoming healthy (code ${exitCode ?? 'null'}, signal ${exitSignal ?? 'none'}).${suffix}`);
        }
        await delay(1500);
    }
    const logTail = readLogTail(logFile);
    const suffix = logTail ? `\n\nRecent runtime log:\n${logTail}` : '';
    throw new Error(`Timed out waiting for ${url} to become healthy after ${Math.round(timeoutMs / 1000)}s.${suffix}`);
}
function readLogTail(logFile, maxChars = 4000) {
    if (!fs.existsSync(logFile)) {
        return '';
    }
    const content = fs.readFileSync(logFile, 'utf-8').trim();
    if (!content) {
        return '';
    }
    return content.slice(-maxChars);
}
async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
function isPidAlive(pid) {
    if (!pid) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=direct-manager.js.map