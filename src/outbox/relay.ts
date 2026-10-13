import type { Pool } from 'pg';
import type { DataSource } from 'typeorm';
import { brokerConfigured } from '../broker/connection';
import {
  parseOrderPlaced,
  type OrderPlacedEvent,
} from '../broker/order-placed';
import { publishOrderPlaced } from '../broker/publish-order-placed';
import type { SqlQuery } from './rows';
import { rowsFrom } from './rows';

/**
 * Thrown after a successful publish and before UPDATE published_at.
 * The surrounding transaction rolls the service row back; the broker does not.
 */
export class RelayCrashError extends Error {
  constructor() {
    super('relay stopped between publish and published_at update');
    this.name = 'RelayCrashError';
  }
}

const CLAIM_UNPUBLISHED = `
  SELECT id, payload
    FROM outbox
   WHERE published_at IS NULL
   ORDER BY created_at, id
     FOR UPDATE SKIP LOCKED
   LIMIT $1
`;

export type RelayOptions = {
  limit?: number;
  crashAfterPublish?: boolean;
};

/**
 * Claim unpublished rows, publish, then mark them. Publish stays before the
 * UPDATE: the failure mode is a duplicate, which the consumer can drop.
 * Marking first would make a failed publish a lost event.
 *
 * Returns how many payloads were handed to the broker, including a handoff
 * whose published_at update then rolled back.
 */
export async function relayOutbox(
  dataSource: DataSource,
  options: RelayOptions = {},
): Promise<number> {
  return runRelay(
    (body) =>
      dataSource.transaction(async (manager) => {
        await body((sql, params) => manager.query(sql, params));
      }),
    options,
  );
}

export async function relayOutboxPool(
  pool: Pool,
  options: RelayOptions = {},
): Promise<number> {
  return runRelay(async (body) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await body((sql, params) => client.query(sql, params));
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    } finally {
      client.release();
    }
  }, options);
}

async function runRelay(
  transaction: (body: (query: SqlQuery) => Promise<void>) => Promise<void>,
  options: RelayOptions,
): Promise<number> {
  if (!brokerConfigured()) {
    throw new Error('BROKER_URL is not set');
  }
  const published = { n: 0 };
  try {
    await transaction(async (query) => {
      await publishClaimed(query, published, options);
    });
  } catch (err) {
    if (isRelayCrash(err)) {
      return published.n;
    }
    throw err;
  }
  return published.n;
}

async function publishClaimed(
  query: SqlQuery,
  published: { n: number },
  options: RelayOptions,
): Promise<void> {
  const rows = rowsFrom(await query(CLAIM_UNPUBLISHED, [options.limit ?? 20]));
  for (const row of rows) {
    await publishOrderPlaced(eventFromPayload(row.payload));
    published.n += 1;
    if (options.crashAfterPublish) {
      throw new RelayCrashError();
    }
    await query(
      `UPDATE outbox
          SET published_at = now(),
              attempts = attempts + 1
        WHERE id = $1`,
      [row.id],
    );
  }
}

function eventFromPayload(payload: unknown): OrderPlacedEvent {
  const encoded =
    typeof payload === 'string' || Buffer.isBuffer(payload)
      ? payload
      : JSON.stringify(payload);
  const buffer = Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded);
  const event = parseOrderPlaced(buffer);
  if (!event) {
    throw new Error('outbox payload is not an order.placed event');
  }
  return event;
}

function isRelayCrash(err: unknown): boolean {
  return (
    err instanceof RelayCrashError ||
    (err as { name?: string })?.name === 'RelayCrashError'
  );
}
