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

export interface N8nTunnelState {
  publicUrl: string;
  targetUrl: string;
  pid: number;
  startedAt: string;
}

export interface TunnelConfig {
  mode: 'quick' | 'custom-domain';
  domain?: string;
  tunnelName?: string;
}

const TUNNEL_TIMEOUT_MS = 30_000;
const CLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const STATE_FILENAME = 'n8n-tunnel-state.json';

export interface TunnelConfig {
  mode: 'quick' | 'custom-domain';
  domain?: string;
  tunnelName?: string;
  hostname?: string;
}

export function getTunnelConfig(serviceName?: string): TunnelConfig {
  const domain = process.env['TUNNEL_DOMAIN']?.trim();
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

function getTunnelCredentialsPath(tunnelName: string): string {
  ensureYagrHomeDir();
  return path.join(getYagrPaths().homeDir, 'tunnels', `${tunnelName}.json`);
}

async function findCloudflaredCredentialsByName(bin: string, tunnelName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, ['tunnel', 'list', '--output', 'json']);
    const tunnels = JSON.parse(stdout);
    const tunnel = tunnels.find((t: { name: string; id: string }) => t.name === tunnelName);
    if (!tunnel) return null;

    const cloudflaredDir = path.join(os.homedir(), '.cloudflared');
    const files = fs.readdirSync(cloudflaredDir);
    for (const file of files) {
      if (file.endsWith('.json') && file !== 'cert.pem') {
        const filePath = path.join(cloudflaredDir, file);
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (content.TunnelID === tunnel.id) {
            return filePath;
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function ensurePersistentTunnel(bin: string, tunnelName: string, domain: string): Promise<string> {
  const credsPath = getTunnelCredentialsPath(tunnelName);
  if (fs.existsSync(credsPath)) {
    return credsPath;
  }
  const tunnelDir = path.dirname(credsPath);
  fs.mkdirSync(tunnelDir, { recursive: true, mode: 0o700 });

  try {
    await execFileAsync(bin, ['tunnel', 'create', tunnelName], {
      cwd: tunnelDir,
    });
  } catch {
    // Tunnel might already exist, find its credentials
  }

  const sourceCreds = await findCloudflaredCredentialsByName(bin, tunnelName);
  if (!sourceCreds) {
    throw new Error(`Failed to find credentials for tunnel ${tunnelName}`);
  }
  fs.copyFileSync(sourceCreds, credsPath);
  return credsPath;
}

// ---------------------------------------------------------------------------
// cloudflared binary resolution and installation
// ---------------------------------------------------------------------------

function getCloudflaredBinDir(): string {
  ensureYagrHomeDir();
  return path.join(getYagrPaths().homeDir, 'bin');
}

function getLocalCloudflaredBinPath(): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(getCloudflaredBinDir(), `cloudflared${ext}`);
}

function resolveCloudflaredDownloadUrl(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux') {
    if (arch === 'arm64') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64';
    if (arch === 'arm') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm';
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
  }

  if (platform === 'darwin') {
    if (arch === 'arm64') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64';
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
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl: string, depth: number) => {
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
async function findCloudflaredBinary(): Promise<string | undefined> {
  // Check PATH first.
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(cmd, ['cloudflared']);
    const found = stdout.trim().split('\n')[0].trim();
    if (found) return found;
  } catch {
    // Not in PATH.
  }

  // Check YAGR_HOME/bin.
  const localBin = getLocalCloudflaredBinPath();
  if (fs.existsSync(localBin)) return localBin;

  return undefined;
}

/**
 * Ensures cloudflared is available. If not found in PATH or YAGR_HOME/bin,
 * downloads the correct binary for this platform.
 *
 * Returns the path to use when spawning cloudflared.
 */
export async function installCloudflaredIfNeeded(
  onProgress?: (message: string) => void,
): Promise<string> {
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
  } catch (err) {
    fs.unlinkSync(destPath);
    throw new Error(`Downloaded cloudflared binary failed to run: ${err instanceof Error ? err.message : String(err)}`);
  }

  onProgress?.(`cloudflared installed at ${destPath}`);
  return destPath;
}

/**
 * Returns true if cloudflared is already available (PATH or YAGR_HOME/bin).
 */
export async function isCloudflaredAvailable(): Promise<boolean> {
  return (await findCloudflaredBinary()) !== undefined;
}

function getTunnelStatePath(): string {
  ensureYagrHomeDir();
  return path.join(getYagrPaths().homeDir, STATE_FILENAME);
}

function readRawTunnelState(): N8nTunnelState | null {
  const statePath = getTunnelStatePath();
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as N8nTunnelState;
  } catch {
    return null;
  }
}

function writeTunnelState(state: N8nTunnelState | null): void {
  const statePath = getTunnelStatePath();
  if (state === null) {
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }

    return;
  }

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 checks for process existence without sending a real signal.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the current tunnel state if the cloudflared process is still alive,
 * or null if no tunnel is active.
 */
export function getActiveTunnelState(): N8nTunnelState | null {
  const state = readRawTunnelState();
  if (!state) {
    return null;
  }

  if (!isPidAlive(state.pid)) {
    return null;
  }

  return state;
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
export async function startN8nTunnel(targetUrl: string, cloudflaredBin?: string): Promise<N8nTunnelState> {
  await stopN8nTunnel();

  const bin = cloudflaredBin ?? await findCloudflaredBinary();
  if (!bin) {
    throw new Error(
      'cloudflared is not installed. Run `yagr n8n tunnel setup` to install it automatically, ' +
      'or install manually from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
    );
  }

  const tunnelConfig = getTunnelConfig('n8n');
  const logFile = path.join(os.tmpdir(), `cloudflared-${Date.now()}.log`);
  let cloudflaredArgs: string[];
  let publicUrl: string;

  if (tunnelConfig.mode === 'custom-domain' && tunnelConfig.hostname && tunnelConfig.tunnelName) {
    const credsPath = await ensurePersistentTunnel(bin, tunnelConfig.tunnelName, tunnelConfig.hostname);
    publicUrl = `https://${tunnelConfig.hostname}`;
    const configPath = path.join(os.tmpdir(), `cloudflared-${tunnelConfig.tunnelName}.yml`);
    const configContent = [
      `tunnel: ${tunnelConfig.tunnelName}`,
      `credentials-file: ${credsPath}`,
      `ingress:`,
      `  - hostname: ${tunnelConfig.hostname}`,
      `    service: ${targetUrl}`,
      `  - service: http_status:404`,
    ].join('\n');
    fs.writeFileSync(configPath, configContent);
    cloudflaredArgs = ['--config', configPath, 'tunnel', 'run'];
  } else {
    cloudflaredArgs = ['tunnel', '--url', targetUrl, '--no-autoupdate', '--logfile', logFile];
    publicUrl = ''; // Will be extracted from log
  }

  return new Promise<N8nTunnelState>((resolve, reject) => {
    const child = spawn(bin, cloudflaredArgs, {
      detached: true,
      stdio: 'ignore',
    });

    if (!child.pid) {
      reject(new Error('cloudflared failed to start (no PID assigned).'));
      return;
    }

    child.unref();

    const pid = child.pid;

    if (tunnelConfig.mode === 'custom-domain') {
      const state: N8nTunnelState = {
        publicUrl: `https://${tunnelConfig.hostname}`,
        targetUrl,
        pid,
        startedAt: new Date().toISOString(),
      };
      writeTunnelState(state);
      resolve(state);
      return;
    }

    let settled = false;

    const cleanup = () => {
      try { fs.unlinkSync(logFile); } catch { /* ignore */ }
    };

    const pollInterval = setInterval(() => {
      if (settled) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const text = fs.readFileSync(logFile, 'utf8');
        const match = text.match(CLOUDFLARE_URL_PATTERN);
        if (match) {
          settled = true;
          clearInterval(pollInterval);
          const state: N8nTunnelState = {
            publicUrl: match[0],
            targetUrl,
            pid,
            startedAt: new Date().toISOString(),
          };
          writeTunnelState(state);
          cleanup();
          resolve(state);
        }
      } catch {
        // Log file not yet created — keep polling.
      }
    }, 500);

    child.on('error', (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(pollInterval);
      cleanup();
      reject(new Error(
        `cloudflared failed to start: ${err.message}. ` +
        `Run \`yagr n8n tunnel setup\` to install it automatically.`,
      ));
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(pollInterval);
      cleanup();
      reject(new Error(
        `cloudflared exited early with code ${code}. ` +
        `Run \`yagr n8n tunnel setup\` to re-install it.`,
      ));
    });

    setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      clearInterval(pollInterval);
      cleanup();
      // cloudflared is already unref'd and detached — leave it running but
      // report the timeout so the caller knows the URL was not captured.
      reject(new Error('cloudflared did not emit a trycloudflare.com URL within 30s.'));
    }, TUNNEL_TIMEOUT_MS);
  });
}

/**
 * Stops the currently running tunnel and removes the state file.
 */
export async function stopN8nTunnel(): Promise<void> {
  const state = readRawTunnelState();
  if (state?.pid && isPidAlive(state.pid)) {
    try {
      process.kill(state.pid, 'SIGTERM');
    } catch {
      // Process already gone — nothing to do.
    }
    const start = Date.now();
    while (isPidAlive(state.pid) && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (isPidAlive(state.pid)) {
      try { process.kill(state.pid, 'SIGKILL'); } catch { /* ignore */ }
    }
  }

  writeTunnelState(null);
}

/**
 * Stops the current tunnel and starts a new one, returning the fresh state.
 */
export async function refreshN8nTunnel(targetUrl: string, cloudflaredBin?: string): Promise<N8nTunnelState> {
  await stopN8nTunnel();
  return startN8nTunnel(targetUrl, cloudflaredBin);
}

// ─── Proxy tunnel state (for LLM relay deduplication) ─────────────────────────

export interface ProxyTunnelState {
  pid: number;
  tunnelUrl: string;
  targetUrl: string;
  startedAt: string;
}

function readNamedTunnelState(statePath: string): ProxyTunnelState | null {
  try {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as ProxyTunnelState;
  } catch {
    return null;
  }
}

function writeNamedTunnelState(statePath: string, state: ProxyTunnelState | null): void {
  if (state === null) {
    try { fs.unlinkSync(statePath); } catch { /* ignore */ }
    return;
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function getNamedActiveTunnelState(statePath: string): ProxyTunnelState | null {
  const state = readNamedTunnelState(statePath);
  if (!state) {
    return null;
  }

  if (!isPidAlive(state.pid)) {
    return null;
  }

  return state;
}

async function startNamedTunnel(targetUrl: string, statePath: string, tunnelNameSuffix: string, cloudflaredBin?: string): Promise<string> {
  const existing = readNamedTunnelState(statePath);
  if (existing && existing.targetUrl === targetUrl && isPidAlive(existing.pid)) {
    return existing.tunnelUrl;
  }

  if (existing?.pid && isPidAlive(existing.pid)) {
    try { process.kill(existing.pid, 'SIGTERM'); } catch { /* ignore */ }
  }
  writeNamedTunnelState(statePath, null);

  const bin = cloudflaredBin ?? await findCloudflaredBinary();
  if (!bin) {
    throw new Error(
      'cloudflared is not installed. Run `yagr n8n tunnel setup` to install it automatically.',
    );
  }

  const tunnelConfig = getTunnelConfig(tunnelNameSuffix);
  const logFile = path.join(os.tmpdir(), `cloudflared-${path.basename(statePath, '.json')}-${Date.now()}.log`);
  let cloudflaredArgs: string[];

  if (tunnelConfig.mode === 'custom-domain' && tunnelConfig.hostname && tunnelConfig.tunnelName) {
    const credsPath = await ensurePersistentTunnel(bin, tunnelConfig.tunnelName, tunnelConfig.hostname);
    const configPath = path.join(os.tmpdir(), `cloudflared-${tunnelConfig.tunnelName}.yml`);
    const configContent = [
      `tunnel: ${tunnelConfig.tunnelName}`,
      `credentials-file: ${credsPath}`,
      `ingress:`,
      `  - hostname: ${tunnelConfig.hostname}`,
      `    service: ${targetUrl}`,
      `  - service: http_status:404`,
    ].join('\n');
    fs.writeFileSync(configPath, configContent);
    cloudflaredArgs = ['--config', configPath, 'tunnel', 'run'];
  } else {
    cloudflaredArgs = ['tunnel', '--url', targetUrl, '--no-autoupdate', '--logfile', logFile];
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, cloudflaredArgs, {
      detached: true,
      stdio: 'ignore',
    });

    if (!child.pid) {
      reject(new Error('cloudflared failed to start (no PID assigned).'));
      return;
    }

    child.unref();
    const pid = child.pid;

    if (tunnelConfig.mode === 'custom-domain') {
      const tunnelUrl = `https://${tunnelConfig.hostname}`;
      writeNamedTunnelState(statePath, { pid, tunnelUrl, targetUrl, startedAt: new Date().toISOString() });
      resolve(tunnelUrl);
      return;
    }

    let settled = false;
    const cleanup = () => { try { fs.unlinkSync(logFile); } catch { /* ignore */ } };

    const pollInterval = setInterval(() => {
      if (settled) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const text = fs.readFileSync(logFile, 'utf8');
        const match = text.match(CLOUDFLARE_URL_PATTERN);
        if (match) {
          settled = true;
          clearInterval(pollInterval);
          cleanup();
          writeNamedTunnelState(statePath, { pid, tunnelUrl: match[0], targetUrl, startedAt: new Date().toISOString() });
          resolve(match[0]);
        }
      } catch { /* log file not yet created */ }
    }, 500);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearInterval(pollInterval);
      cleanup();
      reject(new Error(`cloudflared failed to start: ${err.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearInterval(pollInterval);
      cleanup();
      reject(new Error(`cloudflared exited early with code ${code}.`));
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(pollInterval);
      cleanup();
      reject(new Error('cloudflared did not emit a trycloudflare.com URL within 30s.'));
    }, TUNNEL_TIMEOUT_MS);
  });
}

async function stopNamedTunnel(statePath: string): Promise<void> {
  const state = readNamedTunnelState(statePath);
  if (state?.pid && isPidAlive(state.pid)) {
    try { process.kill(state.pid, 'SIGTERM'); } catch { /* ignore */ }
    const start = Date.now();
    while (isPidAlive(state.pid) && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (isPidAlive(state.pid)) {
      try { process.kill(state.pid, 'SIGKILL'); } catch { /* ignore */ }
    }
  }
  writeNamedTunnelState(statePath, null);
}

function readProxyTunnelState(): ProxyTunnelState | null {
  return readNamedTunnelState(getYagrPaths().proxyTunnelStatePath);
}

function writeProxyTunnelState(state: ProxyTunnelState | null): void {
  writeNamedTunnelState(getYagrPaths().proxyTunnelStatePath, state);
}

/**
 * Starts a detached cloudflared tunnel for an arbitrary target URL and returns
 * the public trycloudflare.com URL.
 *
 * Deduplicates: if a previous proxy tunnel pointing to the same targetUrl is
 * still alive, its URL is returned immediately without spawning a new process.
 * Stale/dead tunnels are cleaned up before spawning a new one.
 */
export async function startProxyTunnel(targetUrl: string, cloudflaredBin?: string): Promise<string> {
  return startNamedTunnel(targetUrl, getYagrPaths().proxyTunnelStatePath, 'proxy', cloudflaredBin);
}

export function getActiveWorkflowOpenTunnelState(): ProxyTunnelState | null {
  return getNamedActiveTunnelState(getYagrPaths().workflowOpenTunnelStatePath);
}

export async function startWorkflowOpenTunnel(targetUrl: string, cloudflaredBin?: string): Promise<string> {
  return startNamedTunnel(targetUrl, getYagrPaths().workflowOpenTunnelStatePath, 'bridge', cloudflaredBin);
}

export async function stopWorkflowOpenTunnel(): Promise<void> {
  await stopNamedTunnel(getYagrPaths().workflowOpenTunnelStatePath);
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
export function resolveN8nTunnelTargetUrl(): string {
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

  throw new Error(
    'The Cloudflare Tunnel feature is only available for Yagr-managed n8n instances. ' +
    'Run `yagr n8n local install` to set one up, or manage your own tunneling for externally-hosted instances.',
  );
}

/**
 * Returns true when the given URL string resolves to a local or private-network address.
 * Covers: localhost, ::1, 127.x, 10.x, 192.168.x, 172.16–31.x
 */
export const isLocalUrl = isLocalN8nUrl;
