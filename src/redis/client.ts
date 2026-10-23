import Redis from 'ioredis';

export function openRedis(
  url: string,
  role: 'cache' | 'state' | 'queue',
): Redis {
  const client = new Redis(url, {
    // The worker blocks on the queue and must survive a blip. Cache and state
    // give up after a few reconnects so a dead Redis rejects the command
    // instead of pinning the HTTP request.
    maxRetriesPerRequest: role === 'queue' ? null : 1,
    enableOfflineQueue: true,
    connectionName: `marketplace-${role}`,
    retryStrategy(times: number): number | null {
      if (role !== 'queue' && times > 3) return null;
      return Math.min(times * 50, 2000);
    },
  });
  client.on('error', (err: Error) => {
    console.error(`redis ${role}: ${err.message}`);
  });
  return client;
}

export async function readConfig(redis: Redis, name: string): Promise<string> {
  const reply = (await redis.config('GET', name)) as string[];
  const index = reply.indexOf(name);
  const value = index >= 0 ? reply[index + 1] : reply[1];
  if (value === undefined) {
    throw new Error(`CONFIG GET ${name} returned ${JSON.stringify(reply)}`);
  }
  return value;
}

export async function deleteByPrefix(
  redis: Redis,
  prefix: string,
): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${prefix}*`,
      'COUNT',
      200,
    );
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}
