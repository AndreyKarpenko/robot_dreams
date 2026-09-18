import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import {
  InitialSchema1757520000000,
  StockBalanceAndJobs1760000000000,
} from '../../../src/db/migrations';

export type TestDb = {
  pool: Pool;
  uri: string;
  stop: () => Promise<void>;
};

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const uri = container.getConnectionUri();
  process.env.DATABASE_URL = uri;
  process.env.DB_URL = uri;

  const ds = new DataSource({
    type: 'postgres',
    url: uri,
    migrations: [InitialSchema1757520000000, StockBalanceAndJobs1760000000000],
    synchronize: false,
    logging: false,
  });
  await ds.initialize();
  try {
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }

  const pool = new Pool({ connectionString: uri });
  return {
    pool,
    uri,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
