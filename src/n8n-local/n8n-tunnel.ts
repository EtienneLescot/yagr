import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
import { readManagedN8nState } from './state.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';

const execFileAsync = promisify(execFile);

export interface N8nTunnelState {
  publicUrl: string;
  targetUrl: string;
  pid: number;
  startedAt: string;
}

const TUNNEL_TIMEOUT_MS = 30_000;
const CLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const STATE_FILENAME = 'n8n-tunnel-state.json';

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

  return new Promise<N8nTunnelState>((resolve, reject) => {
    const logFile = path.join(os.tmpdir(), `cloudflared-${Date.now()}.log`);

    const child = spawn(
      bin,
      ['tunnel', '--url', targetUrl, '--no-autoupdate', '--logfile', logFile],
      {
        detached: true,
        stdio: 'ignore',
      },
    );

    if (!child.pid) {
      reject(new Error('cloudflared failed to start (no PID assigned).'));
      return;
    }

    // Unref immediately — the child is fully detached and survives the parent.
    child.unref();

    const pid = child.pid;
    let settled = false;

    const cleanup = () => {
      try { fs.unlinkSync(logFile); } catch { /* ignore */ }
    };

    // Poll the log file for the public URL (cloudflared writes it to the log).
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
/**
 * Resolves the local n8n URL that should be used as the tunnel target.
 *
 * Precedence:
 *   1. Yagr-managed instance state (always local, port known by Yagr).
 *   2. Externally-configured host — accepted only if it is a local/private URL.
 *
 * Throws a descriptive error if the configured instance is a remote/cloud URL
 * (already publicly reachable, tunneling makes no sense) or if nothing is
 * configured at all.
 */
export function resolveN8nTunnelTargetUrl(): string {
  // Managed instance: Yagr owns the process, port is always local.
  const managedState = readManagedN8nState();
  if (managedState && managedState.status !== 'stopped') {
    return `http://127.0.0.1:${managedState.port}`;
  }

  // Non-managed: accept only if the host is a local/private address.
  const configService = new YagrN8nConfigService();
  const host = configService.getLocalConfig().host;

  if (!host) {
    throw new Error(
      'No n8n instance is configured. ' +
      'Run `yagr n8n local install` to set up a managed instance, or configure a local n8n host first.',
    );
  }

  if (!isLocalUrl(host)) {
    throw new Error(
      `The configured n8n instance (${host}) is a remote or cloud URL and is already publicly accessible. ` +
      `The Cloudflare tunnel applies only to locally-hosted instances.`,
    );
  }

  return host.replace(/\/$/, '');
}

/**
 * Returns true when the given URL string resolves to a local or private-network address.
 * Covers: localhost, ::1, 127.x, 10.x, 192.168.x, 172.16–31.x
 */
export function isLocalUrl(urlString: string): boolean {
  try {
    const { hostname } = new URL(urlString);
    return (
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}
