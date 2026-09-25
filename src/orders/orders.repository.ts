import type { Queryable } from '../db/queryable';

export type OrderRow = {
  id: string;
  status: string;
  total: number;
  buyer_id: string;
  created_at: Date;
};

export type OrderItemRow = {
  product_id: string;
  quantity: number;
  unit_price: number;
};

export type OrderWithItems = {
  order: OrderRow;
  items: OrderItemRow[];
};

export class OrdersRepository {
  constructor(private readonly db: Queryable) {}

  async insert(input: {
    status: string;
    total: number;
    buyerId: string;
  }): Promise<OrderRow> {
    const result = await this.db.query<OrderRow>(
      `INSERT INTO orders (status, total, buyer_id)
       VALUES ($1, $2, $3)
       RETURNING id, status, total, buyer_id, created_at`,
      [input.status, input.total, input.buyerId],
    );
    return result.rows[0];
  }

  async insertItem(input: {
    orderId: string;
    productId: string;
    quantity: number;
    unitPrice: number;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO order_items (quantity, unit_price, order_id, product_id)
       VALUES ($1, $2, $3, $4)`,
      [input.quantity, input.unitPrice, input.orderId, input.productId],
    );
  }

  async findByIdWithItems(id: string | number): Promise<OrderWithItems | null> {
    const result = await this.db.query<{
      id: string;
      status: string;
      total: number;
      buyer_id: string;
      created_at: Date;
      product_id: string | null;
      quantity: number | null;
      unit_price: number | null;
    }>(
      `SELECT o.id, o.status, o.total, o.buyer_id, o.created_at,
              oi.product_id, oi.quantity, oi.unit_price
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.id = $1
        ORDER BY oi.id`,
      [id],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const first = result.rows[0];
    return {
      order: {
        id: first.id,
        status: first.status,
        total: first.total,
        buyer_id: first.buyer_id,
        created_at: first.created_at,
      },
      items: result.rows
        .filter((row) => row.product_id != null)
        .map((row) => ({
          product_id: row.product_id as string,
          quantity: row.quantity as number,
          unit_price: row.unit_price as number,
        })),
    };
  }
}
