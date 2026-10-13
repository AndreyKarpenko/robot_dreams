import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { Env } from '../config/env.schema';
import { openRedis } from './client';

export const CACHE_REDIS = 'CACHE_REDIS';
export const STATE_REDIS = 'STATE_REDIS';

function connect(
  url: string | undefined,
  role: 'cache' | 'state',
): Redis | null {
  if (!url) return null;
  return openRedis(url, role);
}

@Global()
@Module({
  providers: [
    {
      provide: CACHE_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        connect(config.get('REDIS_URL', { infer: true }), 'cache'),
    },
    {
      provide: STATE_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        connect(config.get('REDIS_QUEUE_URL', { infer: true }), 'state'),
    },
  ],
  exports: [CACHE_REDIS, STATE_REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(
    @Inject(CACHE_REDIS) private readonly cache: Redis | null,
    @Inject(STATE_REDIS) private readonly state: Redis | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.cache?.quit(), this.state?.quit()]);
  }
}
