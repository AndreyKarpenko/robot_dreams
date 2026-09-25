import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/database.module';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus } from './dto/update-order-status.dto';
import { OrderEventsService } from './order-events.service';
import { OrderRow, OrdersRepository } from './orders.repository';
import { ProductsRepository } from '../products/products.repository';

export type OrderResponse = {
  id: number;
  status: string;
  buyer_id: number;
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
    private readonly orderEvents: OrderEventsService,
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

  async updateStatus(id: number, status: OrderStatus): Promise<OrderResponse> {
    const client = await this.pool.connect();
    let updated: OrderRow;
    try {
      await client.query('BEGIN');
      const orders = new OrdersRepository(client);
      const row = await orders.updateStatus(id, status);
      if (!row) {
        throw new NotFoundException();
      }
      await client.query('COMMIT');
      updated = row;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    this.orderEvents.publish(Number(updated.id), updated.status);
    const found = await this.orders.findByIdWithItems(updated.id);
    if (!found) {
      throw new NotFoundException();
    }
    return toOrderResponse(found.order, found);
  }
}

function toOrderResponse(
  order: { id: string; status: string; total: number; buyer_id: string },
  found: {
    items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  },
): OrderResponse {
  return {
    id: Number(order.id),
    status: order.status,
    buyer_id: Number(order.buyer_id),
    items: found.items.map((item) => ({
      product_id: Number(item.product_id),
      quantity: item.quantity,
      price_cents: item.unit_price,
    })),
    total_cents: order.total,
  };
}
