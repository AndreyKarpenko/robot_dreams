import type { DataSource } from 'typeorm';
import {
  CheckoutError,
  InsufficientBalanceError,
  InsufficientStockError,
} from './checkout-errors';

export type CheckoutInput = {
  buyerId: string;
  productId: string;
  quantity: number;
};

export type CheckoutResult = {
  orderId: string;
  total: number;
  stockLeft: number;
  balanceLeft: number;
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
 * debit, INSERT order + line, INSERT post-processing job.
 *
 * Oversell guard is `UPDATE … SET stock = stock - n WHERE stock >= n RETURNING`
 * (not a JS read-modify-write). Zero rows ⇒ not enough stock; the whole
 * transaction rolls back, so no orphan orders.
 */
export async function checkout(
  dataSource: DataSource,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new CheckoutError('quantity must be an integer >= 1');
  }

  return dataSource.transaction(async (manager) => {
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

    return {
      orderId,
      total,
      stockLeft: Number(product.stock),
      balanceLeft: Number(buyers[0].balance),
    };
  });
}

export { CheckoutError } from './checkout-errors';
