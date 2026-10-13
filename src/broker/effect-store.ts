import { Pool } from 'pg';

export const ORDER_PLACED_CONSUMER = 'order-placed';

export type EffectCounts = {
  deliveries: number;
  effect: number;
  processed: number;
};

/**
 * Durable idempotency. The effect is the INSERT: a second delivery of the
 * same eventId conflicts and changes nothing. A process-local Set would
 * forget the row on restart and would not exist on another replica.
 */
export class EffectStore {
  private constructor(
    private readonly pool: Pool,
    private readonly ownsPool: boolean,
  ) {}

  static async open(): Promise<EffectStore> {
    const store = new EffectStore(new Pool({ ...dbConfig(), max: 4 }), true);
    await store.ensureSchema();
    return store;
  }

  /**
   * API process. The pool is the application's; migrations own the tables.
   * close() must not end that pool.
   */
  static attach(pool: Pool): EffectStore {
    return new EffectStore(pool, false);
  }

  async reset(): Promise<void> {
    await this.pool.query(
      'TRUNCATE order_placed_effects, order_placed_deliveries, processed_messages',
    );
  }

  /**
   * Delivery row, inbox mark, and effect commit together. A crash before
   * COMMIT leaves none of them, so the redelivery can still apply the effect.
   * A second delivery inserts another delivery row and conflicts on the other
   * two.
   */
  async consumeOnce(
    eventId: string,
    orderId: string,
  ): Promise<{ applied: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO order_placed_deliveries (event_id) VALUES ($1)',
        [eventId],
      );
      await client.query(
        `INSERT INTO processed_messages (message_id, consumer)
         VALUES ($1, $2)
         ON CONFLICT (message_id, consumer) DO NOTHING`,
        [eventId, ORDER_PLACED_CONSUMER],
      );
      const effect = await client.query<{ event_id: string }>(
        `INSERT INTO order_placed_effects (event_id, order_id)
         VALUES ($1, $2)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [eventId, orderId],
      );
      await client.query('COMMIT');
      return { applied: effect.rows.length > 0 };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async counts(): Promise<EffectCounts> {
    const result = await this.pool.query<{
      deliveries: number;
      effect: number;
      processed: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM order_placed_deliveries) AS deliveries,
         (SELECT count(*)::int FROM order_placed_effects) AS effect,
         (SELECT count(*)::int FROM processed_messages) AS processed`,
    );
    const row = result.rows[0];
    return {
      deliveries: Number(row?.deliveries ?? 0),
      effect: Number(row?.effect ?? 0),
      processed: Number(row?.processed ?? 0),
    };
  }

  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
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
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id text NOT NULL,
        consumer text NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (message_id, consumer)
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
