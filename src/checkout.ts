import type { DataSource } from 'typeorm';
import { toOrderPlacedEvent } from './broker/order-placed';
import {
  BusinessWriteCrashedError,
  CheckoutError,
  InsufficientBalanceError,
  InsufficientStockError,
} from './checkout-errors';
import {
  findIdempotentOrderId,
  insertOrderOutbox,
  saveIdempotencyKey,
} from './outbox/idempotency';
import { isUniqueViolation, rowsFrom, type SqlQuery } from './outbox/rows';

export type CheckoutInput = {
  buyerId: string;
  productId: string;
  quantity: number;
  /**
   * Caller's intent, not a hash of the body. The same key returns the same
   * order; a second identical order needs its own key.
   */
  idempotencyKey?: string;
};

export type CheckoutOptions = {
  /** Throw after the outbox INSERT so the business row and the event roll back together. */
  crashAfterOutbox?: boolean;
};

export type CheckoutResult = {
  orderId: string;
  total: number;
  stockLeft: number;
  balanceLeft: number;
  replayed: boolean;
};

type ProductRow = { id: string; stock: number; price: number };
type UserRow = { id: string; balance: number };

function isRowObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Unwrap T[] or TypeORM's `[rows, rowCount]` tuple. */
function coerceRowArray<T>(raw: unknown[]): T[] | undefined {
  if (raw.length === 0) {
    return [];
  }
  if (
    raw.length === 2 &&
    Array.isArray(raw[0]) &&
    (typeof raw[1] === 'number' || raw[1] == null)
  ) {
    return raw[0] as T[];
  }
  if (isRowObject(raw[0])) {
    return raw as T[];
  }
  return undefined;
}

/**
 * Normalize UPDATE/INSERT … RETURNING from TypeORM/pg.
 * Unknown shapes throw — they must not be treated as "zero rows".
 */
function returningRows<T>(raw: unknown): T[] {
  const candidates: unknown[][] = [];
  if (Array.isArray(raw)) {
    candidates.push(raw);
  } else if (isRowObject(raw)) {
    for (const key of ['rows', 'records', 'raw'] as const) {
      const nested = raw[key];
      if (Array.isArray(nested)) {
        candidates.push(nested);
      }
    }
  } else {
    throw new CheckoutError('unexpected RETURNING result shape');
  }

  let sawEmpty = false;
  for (const candidate of candidates) {
    const rows = coerceRowArray<T>(candidate);
    if (rows === undefined) {
      continue;
    }
    if (rows.length > 0) {
      return rows;
    }
    sawEmpty = true;
  }

  if (sawEmpty) {
    return [];
  }
  throw new CheckoutError('unexpected RETURNING result shape');
}

/**
 * Place an order in one transaction: atomic stock decrement, atomic balance
 * debit, INSERT order + line, INSERT post-processing job, INSERT outbox row.
 *
 * The broker is not called here. A relay publishes the outbox row after
 * COMMIT. Oversell guard is `UPDATE … SET stock = stock - n WHERE stock >= n
 * RETURNING` (not a JS read-modify-write). Zero rows ⇒ not enough stock; the
 * whole transaction rolls back, so no orphan orders and no orphan events.
 */
export async function checkout(
  dataSource: DataSource,
  input: CheckoutInput,
  options: CheckoutOptions = {},
  attempt = 0,
): Promise<CheckoutResult> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new CheckoutError('quantity must be an integer >= 1');
  }

  try {
    return await placeOrder(dataSource, input, options);
  } catch (err) {
    if (
      attempt === 0 &&
      !options.crashAfterOutbox &&
      input.idempotencyKey &&
      isUniqueViolation(err)
    ) {
      return checkout(dataSource, input, options, attempt + 1);
    }
    throw err;
  }
}

async function placeOrder(
  dataSource: DataSource,
  input: CheckoutInput,
  options: CheckoutOptions,
): Promise<CheckoutResult> {
  return dataSource.transaction(async (manager) => {
    const query: SqlQuery = (sql, params) => manager.query(sql, params);
    if (input.idempotencyKey) {
      const existingId = await findIdempotentOrderId(
        query,
        input.idempotencyKey,
      );
      if (existingId) {
        return replayedOrder(query, existingId, input);
      }
    }

    const products = returningRows<ProductRow>(
      await manager.query(
        `UPDATE products
            SET stock = stock - $1
          WHERE id = $2
            AND stock >= $1
          RETURNING id, stock, price`,
        [input.quantity, input.productId],
      ),
    );
    if (products.length === 0) {
      throw new InsufficientStockError('not enough stock');
    }
    const product = products[0];
    const total = Number(product.price) * input.quantity;

    const buyers = returningRows<UserRow>(
      await manager.query(
        `UPDATE users
            SET balance = balance - $1
          WHERE id = $2
            AND balance >= $1
          RETURNING id, balance`,
        [total, input.buyerId],
      ),
    );
    if (buyers.length === 0) {
      throw new InsufficientBalanceError('not enough balance');
    }

    const orders: Array<{ id: string }> = await manager.query(
      `INSERT INTO orders (status, total, buyer_id)
       VALUES ('paid', $1, $2)
       RETURNING id`,
      [total, input.buyerId],
    );
    const orderId = String(orders[0].id);

    await manager.query(
      `INSERT INTO order_items (quantity, unit_price, order_id, product_id)
       VALUES ($1, $2, $3, $4)`,
      [input.quantity, Number(product.price), orderId, input.productId],
    );

    await manager.query(
      `INSERT INTO jobs (kind, payload, status, processed)
       VALUES ('send_receipt', $1::jsonb, 'pending', 0)`,
      [
        JSON.stringify({
          orderId,
          buyerId: input.buyerId,
          productId: input.productId,
          quantity: input.quantity,
          total,
        }),
      ],
    );

    await insertOrderOutbox(
      query,
      toOrderPlacedEvent({
        orderId,
        buyerId: input.buyerId,
        total,
        items: [
          {
            productId: input.productId,
            quantity: input.quantity,
            unitPrice: Number(product.price),
          },
        ],
      }),
    );
    if (options.crashAfterOutbox) {
      throw new BusinessWriteCrashedError(
        'business write failed after outbox insert',
      );
    }
    if (input.idempotencyKey) {
      await saveIdempotencyKey(query, input.idempotencyKey, orderId);
    }

    return {
      orderId,
      total,
      stockLeft: Number(product.stock),
      balanceLeft: Number(buyers[0].balance),
      replayed: false,
    };
  });
}

async function replayedOrder(
  query: SqlQuery,
  orderId: string,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const orders = rowsFrom(
    await query(`SELECT total FROM orders WHERE id = $1`, [orderId]),
  );
  if (orders.length === 0) {
    throw new CheckoutError('idempotency key points at a missing order');
  }
  const products = rowsFrom(
    await query(`SELECT stock FROM products WHERE id = $1`, [input.productId]),
  );
  const buyers = rowsFrom(
    await query(`SELECT balance FROM users WHERE id = $1`, [input.buyerId]),
  );
  return {
    orderId,
    total: Number(orders[0].total),
    stockLeft: Number(products[0]?.stock ?? 0),
    balanceLeft: Number(buyers[0]?.balance ?? 0),
    replayed: true,
  };
}

export { CheckoutError } from './checkout-errors';
