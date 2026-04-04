/**
 * Generic asynchronous polling utility.
 *
 * Repeatedly calls `fn` until it returns a non-null/non-undefined value
 * (indicating the async operation has completed), or until the timeout is
 * exceeded.
 *
 * This is the canonical retry/poll primitive for the yagr codebase.
 * Any tool or subsystem that needs to wait for a deferred result should use
 * this instead of writing its own loop.
 */
export interface PollOptions {
  /** Delay between attempts in milliseconds (default: 2000) */
  intervalMs?: number;
  /** Maximum total wait time in milliseconds (default: 30_000) */
  timeoutMs?: number;
  /** Initial delay before the first attempt in milliseconds (default: 0) */
  initialDelayMs?: number;
}

/**
 * Poll an async function until it returns a non-null/non-undefined value, or
 * until the timeout is reached.
 *
 * @param fn        async function to call on each attempt; return null/undefined to keep polling
 * @param options   timing options
 * @returns         the first non-null result, or null if the timeout was reached
 */
export async function pollUntil<T>(
  fn: (attempt: number) => Promise<T | null | undefined>,
  options: PollOptions = {},
): Promise<T | null> {
  const { intervalMs = 2000, timeoutMs = 30_000, initialDelayMs = 0 } = options;

  if (initialDelayMs > 0) {
    await sleep(initialDelayMs);
  }

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    if (attempt > 0) {
      await sleep(intervalMs);
    }

    const result = await fn(attempt);
    if (result != null) {
      return result;
    }

    attempt++;
  }

  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
