import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Env } from '../config/env.schema';

export const PG_POOL = 'PG_POOL';

const SECRET_FILE = join(process.cwd(), 'secrets', 'db_password');

@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const dbUrl = new URL(config.get('DB_URL', { infer: true }));
        const pool = new Pool({
          host: dbUrl.hostname,
          port: Number(dbUrl.port) || 5432,
          database: dbUrl.pathname.replace(/^\//, ''),
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
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
