import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
import { readManagedN8nState } from './state.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';

export interface N8nTunnelState {
  publicUrl: string;
  targetUrl: string;
  pid: number;
  startedAt: string;
}

const TUNNEL_TIMEOUT_MS = 30_000;
const CLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const STATE_FILENAME = 'n8n-tunnel-state.json';

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
 */
export async function startN8nTunnel(targetUrl: string): Promise<N8nTunnelState> {
  await stopN8nTunnel();

  return new Promise<N8nTunnelState>((resolve, reject) => {
    const child = spawn(
      'cloudflared',
      ['tunnel', '--url', targetUrl, '--no-autoupdate', '--logfile', '/dev/null'],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    if (!child.pid) {
      reject(new Error('cloudflared failed to start (no PID assigned).'));
      return;
    }

    const pid = child.pid;
    let settled = false;

    const onData = (data: Buffer) => {
      if (settled) {
        return;
      }

      const text = data.toString();
      const match = text.match(CLOUDFLARE_URL_PATTERN);
      if (!match) {
        return;
      }

      settled = true;
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);

      // Release the pipe references so the parent process can exit cleanly.
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();

      const state: N8nTunnelState = {
        publicUrl: match[0],
        targetUrl,
        pid,
        startedAt: new Date().toISOString(),
      };
      writeTunnelState(state);
      resolve(state);
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(
        `cloudflared not found or failed to start: ${err.message}. ` +
        `Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/`,
      ));
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(
        `cloudflared exited early with code ${code}. ` +
        `Make sure cloudflared is installed: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/`,
      ));
    });

    setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      try {
        child.kill();
      } catch {
        // Ignore — process may have already exited.
      }

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
export async function refreshN8nTunnel(targetUrl: string): Promise<N8nTunnelState> {
  await stopN8nTunnel();
  return startN8nTunnel(targetUrl);
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
