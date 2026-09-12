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

/** TypeORM's pg driver returns `[rows, rowCount]` for UPDATE/DELETE. */
function returningRows<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const first = raw[0];
  if (Array.isArray(first)) {
    return first as T[];
  }
  if (first !== null && typeof first === 'object') {
    return raw as T[];
  }
  return [];
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
