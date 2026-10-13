import type { OrderPlacedEvent } from '../broker/order-placed';
import { rowsFrom, type SqlQuery } from './rows';

/**
 * The header identifies the caller's intent. It is not a hash of the body:
 * two legitimate identical orders are two keys, not one payload.
 */
export function normalizeIdempotencyKey(
  key: string | undefined,
): string | undefined {
  if (key == null) {
    return undefined;
  }
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function findIdempotentOrderId(
  query: SqlQuery,
  key: string,
): Promise<string | null> {
  const rows = rowsFrom(
    await query(`SELECT order_id FROM idempotency_keys WHERE key = $1`, [
      key,
    ]),
  );
  if (rows.length === 0 || rows[0].order_id == null) {
    return null;
  }
  return String(rows[0].order_id);
}

/**
 * Insert, do not ON CONFLICT DO NOTHING. A conflict must abort the whole
 * transaction so the duplicate order and its outbox row roll back together.
 */
export async function saveIdempotencyKey(
  query: SqlQuery,
  key: string,
  orderId: string,
): Promise<void> {
  await query(
    `INSERT INTO idempotency_keys (key, order_id) VALUES ($1, $2)`,
    [key, orderId],
  );
}

export async function insertOrderOutbox(
  query: SqlQuery,
  event: OrderPlacedEvent,
): Promise<void> {
  await query(
    `INSERT INTO outbox (aggregate_type, aggregate_id, type, payload)
     VALUES ('order', $1, $2, $3::jsonb)`,
    [event.data.orderId, event.type, JSON.stringify(event)],
  );
}
