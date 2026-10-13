import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

const SLIDING_WINDOW = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local member = ARGV[3]
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry = 1
if oldest[2] then
  retry = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
  if retry < 1 then retry = 1 end
end
return {0, retry}
`;

export type RateDecision = {
  allowed: boolean;
  retryAfterSec: number;
};

/** 429 carries Retry-After. The demo reports whether that header was set. */
export function rateLimitStatus(
  decision: RateDecision,
  setHeader: (name: string, value: string) => void,
): number {
  if (decision.allowed) return 200;
  setHeader('Retry-After', String(decision.retryAfterSec));
  return 429;
}

/**
 * Sliding window, one script. A fixed window would allow a 2× burst on the
 * boundary; this one does not. The counter is in Redis so every pod shares it.
 */
export class SlidingWindowLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly prefix = 'rl:',
  ) {}

  async consume(identity: string): Promise<RateDecision> {
    const raw = (await this.redis.eval(
      SLIDING_WINDOW,
      1,
      `${this.prefix}${identity}`,
      String(this.windowMs),
      String(this.limit),
      randomUUID(),
    )) as [number, number];
    return {
      allowed: Number(raw[0]) === 1,
      retryAfterSec: Number(raw[1]),
    };
  }
}
