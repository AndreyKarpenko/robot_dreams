import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

const UNLOCK_IF_MINE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/** Base plus a spread of at least 10s, so one warm cycle does not expire together. */
export function jitteredTtlSeconds(base = 300, spread = 60): number {
  return base + Math.floor(Math.random() * (spread + 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Cached<T> =
  | { state: 'hit'; value: T }
  | { state: 'miss' }
  | { state: 'down' };

async function readCache<T>(redis: Redis, key: string): Promise<Cached<T>> {
  let raw: string | null;
  try {
    raw = await redis.get(key);
  } catch (err) {
    console.error(
      `cache read failed for ${key}: ${(err as Error).message}`,
    );
    return { state: 'down' };
  }
  if (raw === null) return { state: 'miss' };
  try {
    return { state: 'hit', value: JSON.parse(raw) as T };
  } catch {
    return { state: 'miss' };
  }
}

async function writeCache(
  redis: Redis,
  key: string,
  value: unknown,
): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', jitteredTtlSeconds());
  } catch (err) {
    // A cache that throws takes the request down with it. The DB value is enough.
    console.error(
      `cache write failed for ${key}: ${(err as Error).message}`,
    );
  }
}

async function unlock(redis: Redis, lockKey: string, token: string): Promise<void> {
  try {
    await redis.eval(UNLOCK_IF_MINE, 1, lockKey, token);
  } catch (err) {
    console.error(
      `cache unlock failed for ${lockKey}: ${(err as Error).message}`,
    );
  }
}

/**
 * One database read for a burst of misses. The lock is an optimisation:
 * if it fails open, callers pay an extra query and still see the same row.
 */
export async function cacheAside<T>(
  redis: Redis,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const first = await readCache<T>(redis, key);
  if (first.state === 'hit') return first.value;
  if (first.state === 'down') return load();

  const token = randomUUID();
  const lockKey = `lock:${key}`;
  const lockTtlMs = 8_000;

  const fill = async (): Promise<T> => {
    try {
      const again = await readCache<T>(redis, key);
      if (again.state === 'hit') return again.value;
      const value = await load();
      await writeCache(redis, key, value);
      return value;
    } finally {
      await unlock(redis, lockKey, token);
    }
  };

  let acquired: string | null = null;
  try {
    acquired = await redis.set(lockKey, token, 'PX', lockTtlMs, 'NX');
  } catch (err) {
    console.error(
      `cache lock failed for ${key}: ${(err as Error).message}`,
    );
    return load();
  }
  if (acquired === 'OK') return fill();

  const deadline = Date.now() + lockTtlMs;
  while (Date.now() < deadline) {
    await sleep(20);
    const waited = await readCache<T>(redis, key);
    if (waited.state === 'hit') return waited.value;
    if (waited.state === 'down') return load();
  }

  try {
    acquired = await redis.set(lockKey, token, 'PX', lockTtlMs, 'NX');
  } catch {
    return load();
  }
  if (acquired === 'OK') return fill();

  const last = await readCache<T>(redis, key);
  if (last.state === 'hit') return last.value;
  return load();
}
