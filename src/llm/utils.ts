/** Default timeout for upstream Codex API calls (ms). */
export const CODEX_UPSTREAM_TIMEOUT_MS = 60_000;

/** Default retry configuration for transient failures. */
export const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 8_000,
  backoffMultiplier: 2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options: { retries?: number; delayMs?: number } = {},
): Promise<T> {
  let attempt = 0;
  let delay = options.delayMs ?? RETRY_CONFIG.initialDelayMs;
  const maxAttempts = options.retries ?? RETRY_CONFIG.maxAttempts;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
    }
  }
}

/** Creates an AbortSignal that times out after `timeoutMs`. */
export function timeoutSignal(timeoutMs: number, _label: string): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  return controller.signal;
}
