import type { Queryable } from '../db/queryable';

export type ProductRow = {
  id: string;
  name: string;
  price: number;
  stock: number;
  seller_id: string;
  created_at: Date;
};

export type ProductWithSellerRow = ProductRow & {
  seller_email: string;
  seller_name: string;
};

export type SellerProductStats = {
  seller_id: string;
  product_count: number;
  price_sum: number;
};

/** Card joins the seller and aggregates sales. This is the read the cache wraps. */
export type ProductCard = {
  id: string;
  name: string;
  price: number;
  stock: number;
  sellerName: string;
  unitsSold: number;
  orderLines: number;
};

type ProductCardRow = {
  id: string;
  name: string;
  price: number;
  stock: number;
  seller_name: string;
  units_sold: number;
  order_lines: number;
};

export class ProductsRepository {
  constructor(private readonly db: Queryable) {}

  async insert(input: {
    name: string;
    price: number;
    stock?: number;
    sellerId: string;
  }): Promise<ProductRow> {
    const result = await this.db.query<ProductRow>(
      `INSERT INTO products (name, price, stock, seller_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, price, stock, seller_id, created_at`,
      [input.name, input.price, input.stock ?? 0, input.sellerId],
    );
    return result.rows[0];
  }

  async findById(id: string | number): Promise<ProductRow | null> {
    const result = await this.db.query<ProductRow>(
      `SELECT id, name, price, stock, seller_id, created_at
         FROM products
        WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByIdWithSeller(
    id: string | number,
  ): Promise<ProductWithSellerRow | null> {
    const result = await this.db.query<ProductWithSellerRow>(
      `SELECT p.id, p.name, p.price, p.stock, p.seller_id, p.created_at,
              u.email AS seller_email, u.name AS seller_name
         FROM products p
         JOIN users u ON u.id = p.seller_id
        WHERE p.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async list(limit = 20): Promise<ProductRow[]> {
    const result = await this.db.query<ProductRow>(
      `SELECT id, name, price, stock, seller_id, created_at
         FROM products
        ORDER BY id
        LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async findCard(id: string | number): Promise<ProductCard | null> {
    const result = await this.db.query<ProductCardRow>(
      `SELECT p.id,
              p.name,
              p.price,
              p.stock,
              u.name AS seller_name,
              COALESCE(SUM(oi.quantity), 0)::int AS units_sold,
              COUNT(oi.id)::int AS order_lines
         FROM products p
         JOIN users u ON u.id = p.seller_id
         LEFT JOIN order_items oi ON oi.product_id = p.id
        WHERE p.id = $1
        GROUP BY p.id, p.name, p.price, p.stock, u.name`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      name: row.name,
      price: Number(row.price),
      stock: Number(row.stock),
      sellerName: row.seller_name,
      unitsSold: Number(row.units_sold),
      orderLines: Number(row.order_lines),
    };
  }

  async statsBySeller(
    sellerId: string | number,
  ): Promise<SellerProductStats | null> {
    const result = await this.db.query<SellerProductStats>(
      `SELECT seller_id,
              COUNT(*)::int AS product_count,
              COALESCE(SUM(price), 0)::int AS price_sum
         FROM products
        WHERE seller_id = $1
        GROUP BY seller_id`,
      [sellerId],
    );
    return result.rows[0] ?? null;
  }
}
