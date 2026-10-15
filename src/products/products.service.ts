import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import { CACHE_REDIS } from '../redis/redis.module';
import { CreateProductDto } from './dto/create-product.dto';
import { readProductCard } from './product-card';
import { ProductRow, ProductsRepository } from './products.repository';

export type ProductResponse = {
  id: number;
  name: string;
  price_cents: number;
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    @Inject(CACHE_REDIS) private readonly cache: Redis | null,
  ) {}

  async findAll(): Promise<{
    items: ProductResponse[];
    next_cursor: null;
  }> {
    const rows = await this.products.list(20);
    return {
      items: rows.map(toProductResponse),
      next_cursor: null,
    };
  }

  async create(
    dto: CreateProductDto,
    sellerId: string,
  ): Promise<ProductResponse> {
    const row = await this.products.insert({
      name: dto.name,
      price: dto.price_cents,
      stock: dto.stock ?? 0,
      sellerId,
    });
    return toProductResponse(row);
  }

  async findOne(id: number): Promise<ProductResponse> {
    if (!this.cache) {
      const row = await this.products.findById(id);
      if (!row) {
        throw new NotFoundException();
      }
      return toProductResponse(row);
    }
    const card = await readProductCard(this.cache, this.products, id);
    if (!card) {
      throw new NotFoundException();
    }
    return {
      id: Number(card.id),
      name: card.name,
      price_cents: card.price,
    };
  }
}

export function toProductResponse(row: ProductRow): ProductResponse {
  return {
    id: Number(row.id),
    name: row.name,
    price_cents: row.price,
  };
}
