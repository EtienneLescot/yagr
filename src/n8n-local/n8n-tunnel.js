import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
import { classifyConfiguredN8nInstance, isLocalN8nUrl } from './instance-classification.js';
const execFileAsync = promisify(execFile);
const TUNNEL_TIMEOUT_MS = 30_000;
const CLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const STATE_FILENAME = 'n8n-tunnel-state.json';
const YAGR_TUNNEL_DOMAIN_ENV = 'TUNNEL_DOMAIN';
export function getTunnelConfig(serviceName) {
    const domain = process.env[YAGR_TUNNEL_DOMAIN_ENV]?.trim();
    if (!domain) {
        return { mode: 'quick' };
    }
    const baseSubdomain = `tunnel.${domain}`;
    const hostname = serviceName ? `${serviceName}.${baseSubdomain}` : baseSubdomain;
    const tunnelNameBase = `yagr-${domain.replace(/[^a-z0-9]/g, '-')}`;
    const tunnelName = serviceName ? `${tunnelNameBase}-${serviceName}` : tunnelNameBase;
    return {
        mode: 'custom-domain',
        domain: baseSubdomain,
        hostname,
        tunnelName,
    };
}
function getTunnelCredentialsPath(tunnelName) {
    ensureYagrHomeDir();
    return path.join(getYagrPaths().homeDir, 'tunnels', `${tunnelName}.json`);
}
async function findCloudflaredTunnelByName(bin, tunnelName) {
    try {
        const { stdout } = await execFileAsync(bin, ['tunnel', 'list', '--output', 'json']);
        const tunnels = JSON.parse(stdout);
        const tunnel = tunnels.find((t) => t.name === tunnelName);
        return tunnel ?? null;
    }
    catch { /* ignore */ }
    return null;
}
function findCloudflaredCredentialsByTunnelId(tunnelId) {
    try {
        const cloudflaredDir = path.join(os.homedir(), '.cloudflared');
        const files = fs.readdirSync(cloudflaredDir);
        for (const file of files) {
            if (file.endsWith('.json') && file !== 'cert.pem') {
                const filePath = path.join(cloudflaredDir, file);
                try {
                    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    if (content.TunnelID === tunnelId) {
                        return filePath;
                    }
                }
                catch {
                    // ignore malformed entries
                }
            }
        }
    }
    catch {
        // ignore
    }
    return null;
}
async function ensurePersistentTunnel(bin, tunnelName, hostname) {
    const credsPath = getTunnelCredentialsPath(tunnelName);
    const tunnelDir = path.dirname(credsPath);
    fs.mkdirSync(tunnelDir, { recursive: true, mode: 0o700 });
    let tunnel = await findCloudflaredTunnelByName(bin, tunnelName);
    try {
        await execFileAsync(bin, ['tunnel', 'create', tunnelName], {
            cwd: tunnelDir,
        });
    }
    catch {
        // Tunnel may already exist.
    }
    tunnel = tunnel ?? await findCloudflaredTunnelByName(bin, tunnelName);
    if (!tunnel) {
        throw new Error(`Failed to resolve Cloudflare tunnel ${tunnelName}`);
    }
    const sourceCreds = findCloudflaredCredentialsByTunnelId(tunnel.id);
    if (!sourceCreds) {
        throw new Error(`Failed to find credentials for tunnel ${tunnelName}`);
    }
    fs.copyFileSync(sourceCreds, credsPath);
    await ensureTunnelDnsRoute(bin, tunnelName, hostname);
    return {
        tunnelId: tunnel.id,
        credentialsPath: credsPath,
    };
}
async function ensureTunnelDnsRoute(bin, tunnelName, hostname) {
    try {
        await execFileAsync(bin, ['tunnel', 'route', 'dns', tunnelName, hostname]);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already exists|already routed|same parameters/i.test(message)) {
            return;
        }
        throw new Error(`Failed to route DNS for ${hostname}: ${message}`);
    }
}
// ---------------------------------------------------------------------------
// cloudflared binary resolution and installation
// ---------------------------------------------------------------------------
function getCloudflaredBinDir() {
    ensureYagrHomeDir();
    return path.join(getYagrPaths().homeDir, 'bin');
}
function getLocalCloudflaredBinPath() {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(getCloudflaredBinDir(), `cloudflared${ext}`);
}
function resolveCloudflaredDownloadUrl() {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === 'linux') {
        if (arch === 'arm64')
            return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64';
        if (arch === 'arm')
            return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm';
        return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
    }
    if (platform === 'darwin') {
        if (arch === 'arm64')
            return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64';
        return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64';
    }
    if (platform === 'win32') {
        return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
    }
    throw new Error(`Unsupported platform for automatic cloudflared installation: ${platform}/${arch}. Install cloudflared manually from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/`);
}
/**
 * Downloads a URL following redirects and writes the body to destPath.
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const follow = (currentUrl, depth) => {
            if (depth > 10) {
                reject(new Error('Too many redirects downloading cloudflared.'));
                return;
            }
            https.get(currentUrl, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    follow(res.headers.location, depth + 1);
                    res.resume();
                    return;
                }
                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`Failed to download cloudflared: HTTP ${res.statusCode ?? 'unknown'}`));
                    res.resume();
                    return;
                }
                const tmpPath = `${destPath}.tmp`;
                const file = fs.createWriteStream(tmpPath);
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    fs.renameSync(tmpPath, destPath);
                    resolve();
                });
                file.on('error', (err) => {
                    fs.unlink(tmpPath, () => undefined);
                    reject(err);
                });
                res.on('error', reject);
            }).on('error', reject);
        };
        follow(url, 0);
    });
}
/**
 * Returns the path to the cloudflared binary, preferring PATH then YAGR_HOME/bin.
 * Returns undefined if not found anywhere.
 */
async function findCloudflaredBinary() {
    // Check PATH first.
    try {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const { stdout } = await execFileAsync(cmd, ['cloudflared']);
        const found = stdout.trim().split('\n')[0].trim();
        if (found)
            return found;
    }
    catch {
        // Not in PATH.
    }
    // Check YAGR_HOME/bin.
    const localBin = getLocalCloudflaredBinPath();
    if (fs.existsSync(localBin))
        return localBin;
    return undefined;
}
/**
 * Ensures cloudflared is available. If not found in PATH or YAGR_HOME/bin,
 * downloads the correct binary for this platform.
 *
 * Returns the path to use when spawning cloudflared.
 */
export async function installCloudflaredIfNeeded(onProgress) {
    const existing = await findCloudflaredBinary();
    if (existing) {
        return existing;
    }
    const binDir = getCloudflaredBinDir();
    fs.mkdirSync(binDir, { recursive: true });
    const destPath = getLocalCloudflaredBinPath();
    const downloadUrl = resolveCloudflaredDownloadUrl();
    onProgress?.(`Downloading cloudflared for ${process.platform}/${process.arch}…`);
    await downloadFile(downloadUrl, destPath);
    // Make executable on non-Windows.
    if (process.platform !== 'win32') {
        fs.chmodSync(destPath, 0o755);
    }
    // Verify it runs.
    try {
        await execFileAsync(destPath, ['--version']);
    }
    catch (err) {
        fs.unlinkSync(destPath);
        throw new Error(`Downloaded cloudflared binary failed to run: ${err instanceof Error ? err.message : String(err)}`);
    }
    onProgress?.(`cloudflared installed at ${destPath}`);
    return destPath;
}
/**
 * Returns true if cloudflared is already available (PATH or YAGR_HOME/bin).
 */
export async function isCloudflaredAvailable() {
    return (await findCloudflaredBinary()) !== undefined;
}
function getTunnelStatePath() {
    ensureYagrHomeDir();
    return path.join(getYagrPaths().homeDir, STATE_FILENAME);
}
function isPidAlive(pid) {
    try {
        // Signal 0 checks for process existence without sending a real signal.
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function readStoredTunnelState(statePath) {
    try {
        if (!fs.existsSync(statePath)) {
            return null;
        }
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        const publicUrl = typeof parsed.publicUrl === 'string' ? parsed.publicUrl : undefined;
        if (!publicUrl || typeof parsed.targetUrl !== 'string' || typeof parsed.pid !== 'number' || typeof parsed.startedAt !== 'string') {
            return null;
        }
        return {
            publicUrl,
            targetUrl: parsed.targetUrl,
            pid: parsed.pid,
            startedAt: parsed.startedAt,
        };
    }
    catch {
        return null;
    }
}
function writeStoredTunnelState(statePath, state) {
    if (state === null) {
        try {
            fs.unlinkSync(statePath);
        }
        catch {
            // already removed
        }
        return;
    }
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
function getActiveTunnelStateByPath(statePath) {
    const state = readStoredTunnelState(statePath);
    if (!state) {
        return null;
    }
    if (!isPidAlive(state.pid)) {
        writeStoredTunnelState(statePath, null);
        return null;
    }
    return state;
}
async function stopTunnelByPath(statePath) {
    const state = readStoredTunnelState(statePath);
    if (state?.pid && isPidAlive(state.pid)) {
        await terminateProcess(state.pid);
    }
    writeStoredTunnelState(statePath, null);
}
async function terminateProcess(pid) {
    try {
        process.kill(pid, 'SIGTERM');
    }
    catch {
        return;
    }
    const start = Date.now();
    while (isPidAlive(pid) && Date.now() - start < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (isPidAlive(pid)) {
        try {
            process.kill(pid, 'SIGKILL');
        }
        catch {
            // already gone
        }
    }
}
async function resolveCloudflaredBinary(cloudflaredBin, missingBinaryMessage) {
    const bin = cloudflaredBin ?? await findCloudflaredBinary();
    if (!bin) {
        throw new Error(missingBinaryMessage);
    }
    return bin;
}
async function prepareTunnelLaunch(bin, serviceName, targetUrl, statePath) {
    const tunnelConfig = getTunnelConfig(serviceName);
    if (tunnelConfig.mode === 'custom-domain' && tunnelConfig.hostname && tunnelConfig.tunnelName) {
        const persistentTunnel = await ensurePersistentTunnel(bin, tunnelConfig.tunnelName, tunnelConfig.hostname);
        const configPath = path.join(os.tmpdir(), `cloudflared-${tunnelConfig.tunnelName}.yml`);
        const configContent = [
            `tunnel: ${persistentTunnel.tunnelId}`,
            `credentials-file: ${persistentTunnel.credentialsPath}`,
            `ingress:`,
            `  - hostname: ${tunnelConfig.hostname}`,
            `    service: ${targetUrl}`,
            `  - service: http_status:404`,
        ].join('\n');
        fs.writeFileSync(configPath, configContent);
        return {
            args: ['--config', configPath, 'tunnel', 'run'],
            publicUrl: `https://${tunnelConfig.hostname}`,
            cleanupPaths: [configPath],
        };
    }
    const logFile = path.join(os.tmpdir(), `cloudflared-${path.basename(statePath, '.json')}-${Date.now()}.log`);
    return {
        args: ['tunnel', '--url', targetUrl, '--no-autoupdate', '--logfile', logFile],
        cleanupPaths: [logFile],
    };
}
function cleanupTunnelFiles(pathsToRemove) {
    for (const filePath of pathsToRemove) {
        try {
            fs.unlinkSync(filePath);
        }
        catch {
            // best effort cleanup
        }
    }
}
async function waitForTunnelPublicUrl(pid, logFile) {
    return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (handler) => {
            if (settled) {
                return;
            }
            settled = true;
            clearInterval(pollInterval);
            clearTimeout(timeout);
            handler();
        };
        const pollInterval = setInterval(() => {
            try {
                const text = fs.readFileSync(logFile, 'utf8');
                const match = text.match(CLOUDFLARE_URL_PATTERN);
                if (match) {
                    finish(() => resolve(match[0]));
                    return;
                }
            }
            catch {
                // Log file not yet created.
            }
            if (!isPidAlive(pid)) {
                finish(() => reject(new Error('cloudflared exited before emitting a public URL.')));
            }
        }, 500);
        const timeout = setTimeout(() => {
            finish(() => reject(new Error('cloudflared did not emit a trycloudflare.com URL within 30s.')));
        }, TUNNEL_TIMEOUT_MS);
    });
}
async function startTunnel(descriptor, targetUrl, cloudflaredBin, forceRestart = false) {
    const existing = getActiveTunnelStateByPath(descriptor.statePath);
    if (!forceRestart && existing?.targetUrl === targetUrl) {
        return existing;
    }
    if (existing) {
        await stopTunnelByPath(descriptor.statePath);
    }
    const bin = await resolveCloudflaredBinary(cloudflaredBin, descriptor.missingBinaryMessage);
    const prepared = await prepareTunnelLaunch(bin, descriptor.serviceName, targetUrl, descriptor.statePath);
    const child = spawn(bin, prepared.args, {
        detached: true,
        stdio: 'ignore',
    });
    if (!child.pid) {
        cleanupTunnelFiles(prepared.cleanupPaths);
        throw new Error('cloudflared failed to start (no PID assigned).');
    }
    child.unref();
    const pid = child.pid;
    try {
        const publicUrl = prepared.publicUrl ?? await waitForTunnelPublicUrl(pid, prepared.cleanupPaths[0]);
        const state = {
            publicUrl,
            targetUrl,
            pid,
            startedAt: new Date().toISOString(),
        };
        writeStoredTunnelState(descriptor.statePath, state);
        return state;
    }
    catch (error) {
        await terminateProcess(pid);
        writeStoredTunnelState(descriptor.statePath, null);
        throw error;
    }
    finally {
        cleanupTunnelFiles(prepared.cleanupPaths);
    }
}
function getN8nTunnelDescriptor() {
    return {
        statePath: getTunnelStatePath(),
        serviceName: 'n8n',
        missingBinaryMessage: 'cloudflared is not installed. Run `yagr n8n tunnel setup` to install it automatically, '
            + 'or install manually from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
    };
}
function getLlmTunnelDescriptor() {
    return {
        statePath: getYagrPaths().llmTunnelStatePath,
        serviceName: 'llm',
        missingBinaryMessage: 'cloudflared is not installed. Run `yagr n8n tunnel setup` to install it automatically.',
    };
}
function getN8nAuthTunnelDescriptor() {
    return {
        statePath: getYagrPaths().n8nAuthTunnelStatePath,
        serviceName: 'n8n-auth',
        missingBinaryMessage: 'cloudflared is not installed. Run `yagr n8n tunnel setup` to install it automatically.',
    };
}
/**
 * Returns the current tunnel state if the cloudflared process is still alive,
 * or null if no tunnel is active.
 */
export function getActiveTunnelState() {
    return getActiveTunnelStateByPath(getN8nTunnelDescriptor().statePath);
}
/**
 * Starts a Cloudflare Tunnel exposing the given local n8n URL to the internet.
 * The cloudflared process is spawned detached and survives the Yagr session.
 * Any previously running tunnel is stopped first.
 *
 * If cloudflaredBin is not provided, it is resolved automatically via
 * findCloudflaredBinary(). Call installCloudflaredIfNeeded() beforehand if
 * you want auto-install; otherwise a missing binary produces a clear error.
 */
export async function startN8nTunnel(targetUrl, cloudflaredBin) {
    await stopN8nTunnel();
    return ensureN8nTunnel(targetUrl, cloudflaredBin);
}
export async function ensureN8nTunnel(targetUrl, cloudflaredBin) {
    return startTunnel(getN8nTunnelDescriptor(), targetUrl, cloudflaredBin);
}
/**
 * Stops the currently running tunnel and removes the state file.
 */
export async function stopN8nTunnel() {
    await stopTunnelByPath(getN8nTunnelDescriptor().statePath);
}
/**
 * Stops the current tunnel and starts a new one, returning the fresh state.
 */
export async function refreshN8nTunnel(targetUrl, cloudflaredBin) {
    await stopN8nTunnel();
    return startN8nTunnel(targetUrl, cloudflaredBin);
}
function toPublicAuxTunnelState(state) {
    if (!state) {
        return null;
    }
    return {
        pid: state.pid,
        publicUrl: state.publicUrl,
        targetUrl: state.targetUrl,
        startedAt: state.startedAt,
    };
}
/**
 * Starts a detached cloudflared tunnel for an arbitrary target URL and returns
 * the public trycloudflare.com URL.
 *
 * Deduplicates: if a previous LLM tunnel pointing to the same targetUrl is
 * still alive, its URL is returned immediately without spawning a new process.
 * Stale/dead tunnels are cleaned up before spawning a new one.
 */
export async function startLlmTunnel(targetUrl, cloudflaredBin) {
    const state = await startTunnel(getLlmTunnelDescriptor(), targetUrl, cloudflaredBin);
    return state.publicUrl;
}
/**
 * Stops the LLM tunnel if it is running and clears its state file.
 */
export async function stopLlmTunnel() {
    await stopTunnelByPath(getYagrPaths().llmTunnelStatePath);
}
/**
 * Stops any existing LLM tunnel and starts a fresh one.
 * Used by startup preflight when the stored public URL is stale.
 */
export async function refreshLlmTunnel(targetUrl, cloudflaredBin) {
    await stopLlmTunnel();
    return startLlmTunnel(targetUrl, cloudflaredBin);
}
export function getActiveN8nAuthTunnelState() {
    const descriptor = getN8nAuthTunnelDescriptor();
    return toPublicAuxTunnelState(getActiveTunnelStateByPath(descriptor.statePath));
}
export async function startN8nAuthTunnel(targetUrl, cloudflaredBin) {
    const state = await startTunnel(getN8nAuthTunnelDescriptor(), targetUrl, cloudflaredBin);
    return state.publicUrl;
}
export async function ensureN8nAuthTunnel(targetUrl, cloudflaredBin) {
    return startN8nAuthTunnel(targetUrl, cloudflaredBin);
}
export async function stopN8nAuthTunnel() {
    const descriptor = getN8nAuthTunnelDescriptor();
    await stopTunnelByPath(descriptor.statePath);
}
/**
 * Stops all tunnel processes (n8n, n8n-auth, llm) and clears their state files.
 * Used by `yagr stop` to ensure no orphaned cloudflared processes remain.
 */
export async function stopAllTunnels() {
    await Promise.allSettled([
        stopTunnelByPath(getTunnelStatePath()),
        stopTunnelByPath(getYagrPaths().llmTunnelStatePath),
        stopTunnelByPath(getYagrPaths().n8nAuthTunnelStatePath),
    ]);
}
/**
 * Resolves the local n8n URL that should be used as the tunnel target.
 *
 * Precedence:
 *   1. Yagr-managed instance (determined by instanceProfile in localConfig).
 *   2. ManagedN8nInstanceState file (fallback for running managed instances).
 *   3. Externally-configured host — accepted only if it is a local/private URL.
 *
 * Throws a descriptive error if the configured instance is a remote/cloud URL
 * (already publicly reachable, tunneling makes no sense) or if nothing is
 * configured at all.
 */
export function resolveN8nTunnelTargetUrl() {
    const classification = classifyConfiguredN8nInstance();
    // Check if instanceProfile indicates Yagr-managed (authoritative source after wizard setup)
    const isYagrManaged = classification.instanceProfile === 'yagr-managed-docker'
        || classification.instanceProfile === 'yagr-managed-direct';
    if (isYagrManaged) {
        if (classification.managedState && classification.managedState.status !== 'stopped') {
            return `http://127.0.0.1:${classification.managedState.port}`;
        }
        if (classification.host && isLocalN8nUrl(classification.host)) {
            return classification.host;
        }
    }
    // Fallback: use managedState if available and running
    const managedState = classification.managedState;
    if (managedState && managedState.status !== 'stopped') {
        return `http://127.0.0.1:${managedState.port}`;
    }
    throw new Error('The Cloudflare Tunnel feature is only available for Yagr-managed n8n instances. ' +
        'Run `yagr n8n local install` to set one up, or manage your own tunneling for externally-hosted instances.');
}
/**
 * Returns true when the given URL string resolves to a local or private-network address.
 * Covers: localhost, ::1, 127.x, 10.x, 192.168.x, 172.16–31.x
 */
export const isLocalUrl = isLocalN8nUrl;
//# sourceMappingURL=n8n-tunnel.js.map