import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Shared HTTP setup so E2E and production boot the same pipes/prefix. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
