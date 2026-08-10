// Exponential backoff with full jitter for retryable failures — network
// hiccups, 5xx from Supabase, transient PostgREST timeouts. Non-retryable
// errors (RLS denials, validation) surface immediately.
//
// Formula: sleep = random(0, base * 2^attempt), capped at maxDelayMs.

const RETRYABLE_MESSAGE_PATTERN =
  /network|fetch|failed to fetch|timed? out|econnreset|econnrefused|5\d\d|throttl/i;

export interface RetryOpts {
  attempts?: number;              // default 4 (1 initial + 3 retries)
  baseDelayMs?: number;           // default 250
  maxDelayMs?: number;            // default 5000
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number) => void;
}

function defaultRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RETRYABLE_MESSAGE_PATTERN.test(msg);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseDelay = opts.baseDelayMs ?? 250;
  const maxDelay = opts.maxDelayMs ?? 5000;
  const isRetryable = opts.isRetryable ?? defaultRetryable;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = i === attempts - 1;
      if (isLast || !isRetryable(err)) throw err;
      const jittered = Math.random() * Math.min(baseDelay * 2 ** i, maxDelay);
      opts.onRetry?.(err, i + 1);
      await sleep(jittered);
    }
  }
  throw lastErr;
}
