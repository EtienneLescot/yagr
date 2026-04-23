/**
 * Local OpenAI-compatible HTTP relay server for n8n Chat Model nodes.
 *
 * n8n credentials of type openAiApi point to this server at the configured baseUrl.
 * Incoming requests are proxied to the currently active Yagr LLM provider, transparently
 * handling OAuth token refresh and other provider-specific auth.
 *
 * Architecture: the relay runs as a detached child process that outlives the agent session.
 * `ensureN8nRelayServer()` spawns that process if not already running.
 * `ensureN8nRelayServerInProcess()` is the entrypoint called inside the child process.
 *
 * Binding: always 0.0.0.0 so Docker containers can reach it via the host bridge address.
 */
export declare const YAGR_LLM_RELAY_HOST_ENV = "YAGR_LLM_RELAY_HOST";
export declare const N8N_RELAY_FAKE_API_KEY = "yagr-relay-key";
export declare const N8N_RELAY_CREDENTIAL_NAME = "Yagr LLM Proxy";
export interface N8nRelayServerState {
    port: number;
    pid: number;
    startedAt: string;
}
export interface N8nRelayInfo {
    port: number;
    /** Base URL to use in the n8n credential (may be docker host IP or tunnel URL) */
    baseUrl: string;
    /** Base URL reachable from the local host machine */
    hostBaseUrl: string;
    apiKey: string;
}
export declare function getN8nRelayState(): N8nRelayServerState | undefined;
/**
 * Resolve the address that Docker containers should use to reach this host.
 * Priority:
 *   1. YAGR_N8N_RELAY_HOST env override
 *   2. host.docker.internal (Docker Desktop / WSL2 mirrored)
 *   3. docker0 bridge IP from network interfaces
 *   4. docker network inspect bridge gateway
 *   5. Fallback: 127.0.0.1
 */
export declare function resolveDockerHostAddress(): Promise<string>;
/**
 * Called from the agent process. Spawns the relay as a detached child if not already running.
 * Returns the baseUrl using the stored proxy config (tunnel, docker host, or loopback).
 */
export declare function ensureN8nRelayServer(): Promise<N8nRelayInfo>;
export declare function buildRelayInfo(port: number): N8nRelayInfo;
/**
 * Called inside the detached child process (llm-relay-entrypoint.ts).
 */
export declare function ensureN8nRelayServerInProcess(): Promise<N8nRelayInfo>;
/**
 * Stops the in-process relay and clears relay state when this process owns it.
 * For tests only — production uses a detached relay child.
 */
export declare function closeN8nRelayServerInProcessForTests(): void;
export declare function translateResponsesRequestToChatCompletionsBody(body: Buffer): Buffer;
//# sourceMappingURL=llm-relay-server.d.ts.map