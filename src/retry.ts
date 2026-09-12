const RETRYABLE_PG_CODES = new Set(['40001', '40P01']);

export function postgresErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const rec = err as {
    code?: unknown;
    driverError?: { code?: unknown };
  };
  const raw = rec.driverError?.code ?? rec.code;
  return typeof raw === 'string' ? raw : undefined;
}

export function isRetryableSerialization(err: unknown): boolean {
  const code = postgresErrorCode(err);
  return code !== undefined && RETRYABLE_PG_CODES.has(code);
}

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (info: { code: string; attempt: number }) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a whole transaction (reads included) on serialization failure (40001)
 * or deadlock (40P01) only. Other SQLSTATE codes are permanent or unknown and
 * must not be retried.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 12;
  const baseDelayMs = options.baseDelayMs ?? 15;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const code = postgresErrorCode(err);
      if (
        code === undefined ||
        !RETRYABLE_PG_CODES.has(code) ||
        attempt === maxAttempts
      ) {
        throw err;
      }
      options.onRetry?.({ code, attempt });
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * baseDelayMs);
      await sleep(backoff + jitter);
    }
  }

  throw new Error('withRetry: unreachable');
}
