import { openRedis } from './redis/client';
import { SessionStore } from './redis/session-store';

const REQUESTS = 3;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function print(rows: Record<string, number>): void {
  for (const [key, value] of Object.entries(rows)) {
    console.log(`${key}=${value}`);
  }
}

async function main(): Promise<void> {
  // Sessions sit on the queue instance: the cache policy would evict them.
  const redis = openRedis(required('REDIS_QUEUE_URL'), 'state');
  const sessions = new SessionStore(redis, 30, 'hw23:session:');
  let id: string | null = null;

  try {
    id = await sessions.create('buyer-1');
    const seen = new Set<string>();

    const first = await sessions.read(id);
    if (!first) throw new Error('session missing on the first request');
    seen.add(id);

    await sleep(2000);
    const before = await sessions.ttl(id);
    const second = await sessions.read(id);
    if (!second) throw new Error('session missing on the second request');
    seen.add(id);
    const after = await sessions.ttl(id);

    const third = await sessions.read(id);
    if (!third) throw new Error('session missing on the third request');
    seen.add(id);

    const rows = {
      requests: REQUESTS,
      sessions: seen.size,
      'in-redis': (await redis.exists(sessions.key(id))) === 1 ? 1 : 0,
      'ttl-renewed': after > before ? 1 : 0,
    };
    print(rows);
    if (
      rows.requests < 3 ||
      rows.sessions !== 1 ||
      rows['in-redis'] !== 1 ||
      rows['ttl-renewed'] !== 1
    ) {
      throw new Error(
        `session demo outside the contract: ${JSON.stringify(rows)} before=${before} after=${after}`,
      );
    }
  } finally {
    if (id) await redis.del(sessions.key(id));
    await redis.quit();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
