import { isLocalN8nUrl } from './instance-classification.js';
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
    hostname?: string;
}
export declare function getTunnelConfig(serviceName?: string): TunnelConfig;
/**
 * Ensures cloudflared is available. If not found in PATH or YAGR_HOME/bin,
 * downloads the correct binary for this platform.
 *
 * Returns the path to use when spawning cloudflared.
 */
export declare function installCloudflaredIfNeeded(onProgress?: (message: string) => void): Promise<string>;
/**
 * Returns true if cloudflared is already available (PATH or YAGR_HOME/bin).
 */
export declare function isCloudflaredAvailable(): Promise<boolean>;
/**
 * Returns the current tunnel state if the cloudflared process is still alive,
 * or null if no tunnel is active.
 */
export declare function getActiveTunnelState(): N8nTunnelState | null;
/**
 * Starts a Cloudflare Tunnel exposing the given local n8n URL to the internet.
 * The cloudflared process is spawned detached and survives the Yagr session.
 * Any previously running tunnel is stopped first.
 *
 * If cloudflaredBin is not provided, it is resolved automatically via
 * findCloudflaredBinary(). Call installCloudflaredIfNeeded() beforehand if
 * you want auto-install; otherwise a missing binary produces a clear error.
 */
export declare function startN8nTunnel(targetUrl: string, cloudflaredBin?: string): Promise<N8nTunnelState>;
export declare function ensureN8nTunnel(targetUrl: string, cloudflaredBin?: string): Promise<N8nTunnelState>;
/**
 * Stops the currently running tunnel and removes the state file.
 */
export declare function stopN8nTunnel(): Promise<void>;
/**
 * Stops the current tunnel and starts a new one, returning the fresh state.
 */
export declare function refreshN8nTunnel(targetUrl: string, cloudflaredBin?: string): Promise<N8nTunnelState>;
export interface PublicAuxTunnelState {
    pid: number;
    publicUrl: string;
    targetUrl: string;
    startedAt: string;
}
/**
 * Starts a detached cloudflared tunnel for an arbitrary target URL and returns
 * the public trycloudflare.com URL.
 *
 * Deduplicates: if a previous LLM tunnel pointing to the same targetUrl is
 * still alive, its URL is returned immediately without spawning a new process.
 * Stale/dead tunnels are cleaned up before spawning a new one.
 */
export declare function startLlmTunnel(targetUrl: string, cloudflaredBin?: string): Promise<string>;
/**
 * Stops the LLM tunnel if it is running and clears its state file.
 */
export declare function stopLlmTunnel(): Promise<void>;
/**
 * Stops any existing LLM tunnel and starts a fresh one.
 * Used by startup preflight when the stored public URL is stale.
 */
export declare function refreshLlmTunnel(targetUrl: string, cloudflaredBin?: string): Promise<string>;
export declare function getActiveN8nAuthTunnelState(): PublicAuxTunnelState | null;
export declare function startN8nAuthTunnel(targetUrl: string, cloudflaredBin?: string): Promise<string>;
export declare function ensureN8nAuthTunnel(targetUrl: string, cloudflaredBin?: string): Promise<string>;
export declare function stopN8nAuthTunnel(): Promise<void>;
/**
 * Stops all tunnel processes (n8n, n8n-auth, llm) and clears their state files.
 * Used by `yagr stop` to ensure no orphaned cloudflared processes remain.
 */
export declare function stopAllTunnels(): Promise<void>;
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
export declare function resolveN8nTunnelTargetUrl(): string;
/**
 * Returns true when the given URL string resolves to a local or private-network address.
 * Covers: localhost, ::1, 127.x, 10.x, 192.168.x, 172.16–31.x
 */
export declare const isLocalUrl: typeof isLocalN8nUrl;
//# sourceMappingURL=n8n-tunnel.d.ts.map