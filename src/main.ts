import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { AppModule } from './app.module';
import { Env } from './config/env.schema';
import { configureApp } from './configure-app';
import { rateLimitMiddleware, sessionMiddleware } from './redis/http';
import { STATE_REDIS } from './redis/redis.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const state = app.get<Redis | null>(STATE_REDIS);
  if (state) {
    app.use(sessionMiddleware(state));
    app.use(rateLimitMiddleware(state));
  }
  const config = app.get(ConfigService<Env, true>);
  const PORT = config.get('PORT', { infer: true });
  await app.listen(PORT);
}

void bootstrap();
