import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { loadEnvFile } from 'node:process';
import type Redis from 'ioredis';
import { AppModule } from './app.module';
import { Env, validate } from './config/env.schema';
import { configureApp } from './configure-app';
import { rateLimitMiddleware, sessionMiddleware } from './redis/http';
import { STATE_REDIS } from './redis/redis.module';

function loadLocalEnv(): void {
  try {
    // Does not override variables already in the environment (vault, grader).
    loadEnvFile();
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code !== 'ENOENT') {
      throw err;
    }
  }
}

async function bootstrap() {
  loadLocalEnv();
  // Name a missing signing key before the pool exists. A DB error here would
  // hide the variable the process actually lacks.
  validate(process.env);
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

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
