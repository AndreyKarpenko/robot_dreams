import { Pool } from 'pg';

export type EffectCounts = {
  deliveries: number;
  effect: number;
};

/**
 * Durable idempotency. The effect is the INSERT: a second delivery of the
 * same eventId conflicts and changes nothing. A process-local Set would
 * forget the row on restart and would not exist on another replica.
 */
export class EffectStore {
  private constructor(private readonly pool: Pool) {}

  static async open(): Promise<EffectStore> {
    const store = new EffectStore(new Pool({ ...dbConfig(), max: 4 }));
    await store.ensureSchema();
    return store;
  }

  async reset(): Promise<void> {
    await this.pool.query(
      'TRUNCATE order_placed_effects, order_placed_deliveries',
    );
  }

  async recordDelivery(eventId: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO order_placed_deliveries (event_id) VALUES ($1)',
      [eventId],
    );
  }

  /** @returns true when this delivery applied the effect, false when it was a duplicate. */
  async applyEffect(eventId: string, orderId: string): Promise<boolean> {
    const result = await this.pool.query<{ event_id: string }>(
      `INSERT INTO order_placed_effects (event_id, order_id)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, orderId],
    );
    return result.rows.length > 0;
  }

  async counts(): Promise<EffectCounts> {
    const result = await this.pool.query<{
      deliveries: number;
      effect: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM order_placed_deliveries) AS deliveries,
         (SELECT count(*)::int FROM order_placed_effects) AS effect`,
    );
    const row = result.rows[0];
    return {
      deliveries: Number(row?.deliveries ?? 0),
      effect: Number(row?.effect ?? 0),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS order_placed_effects (
        event_id text PRIMARY KEY,
        order_id text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS order_placed_deliveries (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        event_id text NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }
}

function dbConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;
  const port = Number(process.env.DB_PORT ?? '5432');
  if (
    !host ||
    !user ||
    password === undefined ||
    !database ||
    !Number.isFinite(port)
  ) {
    throw new Error(
      'DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME are required',
    );
  }
  return { host, port, user, password, database };
}
