import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/database.module';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersRepository } from './orders.repository';
import { ProductsRepository } from '../products/products.repository';

export type OrderResponse = {
  id: number;
  status: string;
  items: Array<{
    product_id: number;
    quantity: number;
    price_cents: number;
  }>;
  total_cents: number;
};

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly orders: OrdersRepository,
  ) {}

  async create(dto: CreateOrderDto): Promise<OrderResponse> {
    const buyerId = process.env.DEFAULT_BUYER_ID;
    if (!buyerId) {
      throw new BadRequestException('buyer is not configured');
    }

    const merged = new Map<number, number>();
    for (const item of dto.items) {
      merged.set(
        item.product_id,
        (merged.get(item.product_id) ?? 0) + item.quantity,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const products = new ProductsRepository(client);
      const orders = new OrdersRepository(client);

      const lines: Array<{
        productId: string;
        quantity: number;
        unitPrice: number;
      }> = [];
      for (const [productId, quantity] of merged) {
        const product = await products.findById(productId);
        if (!product) {
          throw new NotFoundException(`product ${productId} not found`);
        }
        lines.push({
          productId: product.id,
          quantity,
          unitPrice: product.price,
        });
      }

      const total = lines.reduce(
        (sum, line) => sum + line.unitPrice * line.quantity,
        0,
      );
      const order = await orders.insert({
        status: 'created',
        total,
        buyerId,
      });
      for (const line of lines) {
        await orders.insertItem({
          orderId: order.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        });
      }

      await client.query('COMMIT');
      return toOrderResponse(order, {
        items: lines.map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
          unit_price: line.unitPrice,
        })),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  findAll(): { items: OrderResponse[]; next_cursor: null } {
    return { items: [], next_cursor: null };
  }

  async findOne(id: number): Promise<OrderResponse> {
    const found = await this.orders.findByIdWithItems(id);
    if (!found) {
      throw new NotFoundException();
    }
    return toOrderResponse(found.order, found);
  }
}

function toOrderResponse(
  order: { id: string; status: string; total: number },
  found: {
    items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  },
): OrderResponse {
  return {
    id: Number(order.id),
    status: order.status,
    items: found.items.map((item) => ({
      product_id: Number(item.product_id),
      quantity: item.quantity,
      price_cents: item.unit_price,
    })),
    total_cents: order.total,
  };
}
