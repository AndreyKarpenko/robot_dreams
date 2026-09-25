import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Env } from './config/env.schema';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const config = app.get(ConfigService<Env, true>);
  const PORT = config.get('PORT', { infer: true });
  await app.listen(PORT);
}

void bootstrap();
