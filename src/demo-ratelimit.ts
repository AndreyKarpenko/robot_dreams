import { openRedis } from './redis/client';
import { rateLimitStatus, SlidingWindowLimiter } from './redis/sliding-window';

const LIMIT = 5;
const REQUESTS = 8;
const KEY = 'hw23:rl:shared-demo';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function print(rows: Record<string, number>): void {
  for (const [key, value] of Object.entries(rows)) {
    console.log(`${key}=${value}`);
  }
}

async function main(): Promise<void> {
  const url = required('REDIS_QUEUE_URL');
  const clients = [0, 1].map(() => openRedis(url, 'state'));
  const pods = clients.map(
    (redis) => new SlidingWindowLimiter(redis, LIMIT, 10_000, 'hw23:rl:'),
  );

  try {
    await clients[0].del(KEY);
    let allowed = 0;
    let blocked = 0;
    let status = 0;
    let retryAfter = 0;

    for (let i = 0; i < REQUESTS; i += 1) {
      const headers: Record<string, string> = {};
      const code = rateLimitStatus(
        await pods[i % pods.length].consume('shared-demo'),
        (name, value) => {
          headers[name] = value;
        },
      );
      if (code === 200) {
        allowed += 1;
      } else {
        blocked += 1;
        status = code;
        retryAfter = headers['Retry-After'] ? 1 : 0;
      }
    }

    const rows = {
      instances: pods.length,
      limit: LIMIT,
      requests: REQUESTS,
      allowed,
      blocked,
      status,
      'retry-after': retryAfter,
    };
    print(rows);
    if (
      rows.instances < 2 ||
      rows.limit <= 0 ||
      rows.allowed !== rows.limit ||
      rows.blocked < 1 ||
      rows.status !== 429 ||
      rows['retry-after'] !== 1
    ) {
      throw new Error(`ratelimit demo outside the contract: ${JSON.stringify(rows)}`);
    }
  } finally {
    await clients[0].del(KEY);
    await Promise.all(clients.map((client) => client.quit()));
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
