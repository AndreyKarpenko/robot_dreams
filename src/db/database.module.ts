import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Env } from '../config/env.schema';

export const PG_POOL = 'PG_POOL';

const SECRET_FILE = join(process.cwd(), 'secrets', 'db_password');

function buildPool(config: ConfigService<Env, true>): Pool {
  // Tests get DATABASE_URL from testcontainers (password in the URI).
  // The running app still uses DB_URL + secrets/db_password.
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    pool.on('error', (err) => {
      console.error(
        `pg pool closed an idle client (${err.message}) — a new connection will be opened`,
      );
    });
    return pool;
  }

  const dbUrl = new URL(config.get('DB_URL', { infer: true }));
  const pool = new Pool({
    host: dbUrl.hostname,
    port: Number(dbUrl.port) || 5432,
    database: dbUrl.pathname.replace(/^\//, '').split('?')[0],
    user: decodeURIComponent(dbUrl.username),
    password: async () => (await readFile(SECRET_FILE, 'utf8')).trim(),
    max: 3,
  });

  // pg_terminate_backend emits 'error' on idle clients; without this, Node exits.
  pool.on('error', (err) => {
    console.error(
      `pg pool closed an idle client (${err.message}) — a new connection will be opened`,
    );
  });

  return pool;
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: buildPool,
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
