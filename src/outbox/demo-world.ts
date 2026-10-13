import type { DataSource } from 'typeorm';
import { closeBroker, getBrokerConnection } from '../broker/connection';
import { EffectStore } from '../broker/effect-store';
import { declareTopology, WORK_QUEUE } from '../broker/topology';
import AppDataSource from '../data-source';
import { rowsFrom } from './rows';

const SELLER_EMAIL = 'hw22-seller@shop.test';
const BUYER_EMAIL = 'hw22-buyer@shop.test';
const PRODUCT_NAME = 'HW22 notebook';

export const DEMO_STOCK = 50;
export const DEMO_BALANCE = 10_000_000;

export type DemoWorld = {
  dataSource: DataSource;
  store: EffectStore;
  buyerId: string;
  productId: string;
};

export type DemoCounts = {
  orders: number;
  outbox: number;
  pending: number;
  deliveries: number;
  effect: number;
  processed: number;
};

export async function openDemoWorld(): Promise<DemoWorld> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  await AppDataSource.runMigrations();
  const store = await EffectStore.open();
  const buyerId = await ensureUser(AppDataSource, BUYER_EMAIL, 'HW22 Buyer', 0);
  const sellerId = await ensureUser(
    AppDataSource,
    SELLER_EMAIL,
    'HW22 Seller',
    0,
  );
  const productId = await ensureProduct(AppDataSource, sellerId);
  const world = { dataSource: AppDataSource, store, buyerId, productId };
  await resetDemoWorld(world);
  return world;
}

export async function resetDemoWorld(world: DemoWorld): Promise<void> {
  await world.dataSource.query(
    `DELETE FROM idempotency_keys WHERE key LIKE 'hw22-%'`,
  );
  await world.dataSource.query(`DELETE FROM orders WHERE buyer_id = $1`, [
    world.buyerId,
  ]);
  await world.dataSource.query(`DELETE FROM outbox`);
  await world.store.reset();
  await world.dataSource.query(`UPDATE products SET stock = $1 WHERE id = $2`, [
    DEMO_STOCK,
    world.productId,
  ]);
  await world.dataSource.query(`UPDATE users SET balance = $1 WHERE id = $2`, [
    DEMO_BALANCE,
    world.buyerId,
  ]);
}

export async function prepareBroker(): Promise<void> {
  const connection = await getBrokerConnection();
  await declareTopology(connection);
  const channel = await connection.createChannel();
  try {
    await channel.purgeQueue(WORK_QUEUE);
  } finally {
    await channel.close().catch(() => undefined);
  }
}

export async function demoCounts(world: DemoWorld): Promise<DemoCounts> {
  const effects = await world.store.counts();
  return {
    orders: await scalar(
      world.dataSource,
      `SELECT count(*)::int AS n FROM orders WHERE buyer_id = $1`,
      [world.buyerId],
    ),
    outbox: await scalar(
      world.dataSource,
      `SELECT count(*)::int AS n FROM outbox`,
    ),
    pending: await scalar(
      world.dataSource,
      `SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL`,
    ),
    deliveries: effects.deliveries,
    effect: effects.effect,
    processed: effects.processed,
  };
}

export async function closeDemoWorld(world: DemoWorld): Promise<void> {
  await closeBroker();
  await world.store.close();
  if (world.dataSource.isInitialized) {
    await world.dataSource.destroy();
  }
}

async function ensureUser(
  dataSource: DataSource,
  email: string,
  name: string,
  balance: number,
): Promise<string> {
  const existing = rowsFrom(
    await dataSource.query(`SELECT id FROM users WHERE email = $1`, [email]),
  );
  if (existing.length > 0) {
    return String(existing[0].id);
  }
  const inserted = rowsFrom(
    await dataSource.query(
      `INSERT INTO users (email, name, balance)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [email, name, balance],
    ),
  );
  return String(inserted[0].id);
}

async function ensureProduct(
  dataSource: DataSource,
  sellerId: string,
): Promise<string> {
  const existing = rowsFrom(
    await dataSource.query(
      `SELECT id FROM products WHERE name = $1 AND seller_id = $2`,
      [PRODUCT_NAME, sellerId],
    ),
  );
  if (existing.length > 0) {
    return String(existing[0].id);
  }
  const inserted = rowsFrom(
    await dataSource.query(
      `INSERT INTO products (name, price, stock, seller_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [PRODUCT_NAME, 2500, DEMO_STOCK, sellerId],
    ),
  );
  return String(inserted[0].id);
}

async function scalar(
  dataSource: DataSource,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const rows = rowsFrom(await dataSource.query(sql, params));
  return Number(rows[0]?.n ?? 0);
}
