import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

export type SessionData = {
  userId: string;
};

/**
 * Sessions live on the noeviction Redis. The cache instance is allkeys-lru
 * and will eventually drop a live session.
 */
export class SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 30,
    private readonly prefix = 'session:',
  ) {}

  key(id: string): string {
    return `${this.prefix}${id}`;
  }

  async create(userId: string): Promise<string> {
    const id = randomUUID();
    await this.redis.set(
      this.key(id),
      JSON.stringify({ userId } satisfies SessionData),
      'EX',
      this.ttlSec,
    );
    return id;
  }

  /** Read and roll the TTL forward. An idle session still expires. */
  async read(id: string): Promise<SessionData | null> {
    const raw = await this.redis.getex(this.key(id), 'EX', this.ttlSec);
    if (raw === null) return null;
    return JSON.parse(raw) as SessionData;
  }

  async ttl(id: string): Promise<number> {
    return this.redis.ttl(this.key(id));
  }
}
