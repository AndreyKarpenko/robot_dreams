import { Injectable, NotFoundException } from '@nestjs/common';
import { ProductRow, ProductsRepository } from './products.repository';

export type ProductResponse = {
  id: number;
  name: string;
  price_cents: number;
};

@Injectable()
export class ProductsService {
  constructor(private readonly products: ProductsRepository) {}

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

  async findOne(id: number): Promise<ProductResponse> {
    const row = await this.products.findById(id);
    if (!row) {
      throw new NotFoundException();
    }
    return toProductResponse(row);
  }
}

export function toProductResponse(row: ProductRow): ProductResponse {
  return {
    id: Number(row.id),
    name: row.name,
    price_cents: row.price,
  };
}
