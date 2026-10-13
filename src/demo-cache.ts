import { Pool } from 'pg';
import type { Queryable } from './db/queryable';
import { ProductsRepository } from './products/products.repository';
import { UsersRepository } from './users/users.repository';
import { cacheAside } from './redis/cache-aside';
import { deleteByPrefix, openRedis, readConfig } from './redis/client';

const WARMED = 60;
const CONCURRENT = 24;
const WARM_READS = 100;
const KEY_PREFIX = 'hw23:card:';

function poolFromEnv(): Pool {
  const url = process.env.DATABASE_URL;
  if (url) return new Pool({ connectionString: url, max: 4 });
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT;
  const user = process.env.DB_USER;
  const database = process.env.DB_NAME;
  if (!host || !port || !user || !database) {
    throw new Error(
      'Set DATABASE_URL or DB_HOST, DB_PORT, DB_USER, DB_NAME',
    );
  }
  return new Pool({
    host,
    port: Number(port),
    user,
    password: process.env.DB_PASSWORD,
    database,
    max: 4,
  });
}

function countingQueryable(db: Queryable, counter: { n: number }): Queryable {
  const query = ((text: string, params?: unknown[]) => {
    counter.n += 1;
    return db.query(text, params);
  }) as Queryable['query'];
  return { query } as Queryable;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function print(rows: Record<string, number>): void {
  for (const [key, value] of Object.entries(rows)) {
    console.log(`${key}=${value}`);
  }
}

async function main(): Promise<void> {
  const cache = openRedis(required('REDIS_URL'), 'cache');
  const pool = poolFromEnv();
  const users = new UsersRepository(pool);
  const products = new ProductsRepository(pool);
  let sellerId: string | null = null;

  try {
    const policy = await readConfig(cache, 'maxmemory-policy');
    const maxmemory = Number(await readConfig(cache, 'maxmemory'));
    await deleteByPrefix(cache, KEY_PREFIX);
    await deleteByPrefix(cache, `lock:${KEY_PREFIX}`);

    const seller = await users.insert({
      email: `hw23-cache-${Date.now()}@shop.test`,
      name: 'HW23 Cache',
    });
    sellerId = seller.id;
    const ids: string[] = [];
    for (let i = 0; i < WARMED; i += 1) {
      const row = await products.insert({
        name: `HW23 card ${i}`,
        price: 1000 + i,
        stock: 5,
        sellerId: seller.id,
      });
      ids.push(row.id);
    }

    const counter = { n: 0 };
    const measured = new ProductsRepository(countingQueryable(pool, counter));
    const read = (id: string) =>
      cacheAside(cache, `${KEY_PREFIX}${id}`, () => measured.findCard(id));

    for (const id of ids) {
      const card = await read(id);
      if (!card) throw new Error(`product ${id} missing on warm`);
    }

    const ttls = new Set<number>();
    for (const id of ids) {
      const ttl = await cache.ttl(`${KEY_PREFIX}${id}`);
      if (ttl > 0) ttls.add(ttl);
    }

    const coldId = ids[0];
    await cache.del(`${KEY_PREFIX}${coldId}`, `lock:${KEY_PREFIX}${coldId}`);
    counter.n = 0;
    await Promise.all(
      Array.from({ length: CONCURRENT }, () => read(coldId)),
    );
    const dbCalls = counter.n;

    const warmId = ids[1];
    counter.n = 0;
    for (let i = 0; i < WARM_READS; i += 1) {
      await read(warmId);
    }
    const dbCallsWarm = counter.n;

    const rows = {
      'cache-lru': policy !== 'noeviction' ? 1 : 0,
      'cache-maxmemory': maxmemory > 0 ? 1 : 0,
      warmed: ids.length,
      'ttl-distinct': ttls.size,
      concurrent: CONCURRENT,
      'db-calls': dbCalls,
      'db-calls-warm': dbCallsWarm,
    };
    print(rows);
    if (
      rows['cache-lru'] !== 1 ||
      rows['cache-maxmemory'] !== 1 ||
      rows.warmed < 50 ||
      rows['ttl-distinct'] < 5 ||
      rows.concurrent < 20 ||
      rows['db-calls'] !== 1 ||
      rows['db-calls-warm'] !== 0
    ) {
      throw new Error(`cache demo outside the contract: ${JSON.stringify(rows)}`);
    }
  } finally {
    if (sellerId) {
      await pool.query('DELETE FROM products WHERE seller_id = $1', [sellerId]);
      await pool.query('DELETE FROM users WHERE id = $1', [sellerId]);
    }
    await deleteByPrefix(cache, KEY_PREFIX);
    await deleteByPrefix(cache, `lock:${KEY_PREFIX}`);
    await cache.quit();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
