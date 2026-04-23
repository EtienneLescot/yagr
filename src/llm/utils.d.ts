/** Default timeout for upstream Codex API calls (ms). */
export declare const CODEX_UPSTREAM_TIMEOUT_MS: number;
/** Default retry configuration for transient failures. */
export declare const RETRY_CONFIG: {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
};
export declare function withRetry<T>(fn: () => Promise<T>, label: string, options?: {
    retries?: number;
    delayMs?: number;
}): Promise<T>;
/** Creates an AbortSignal that times out after `timeoutMs`. */
export declare function timeoutSignal(timeoutMs: number, _label: string): AbortSignal;
export declare function parseCodexUpstreamTimeoutMs(value: string | undefined, fallback?: number): number;
//# sourceMappingURL=utils.d.ts.map