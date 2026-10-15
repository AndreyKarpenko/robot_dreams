import type Redis from 'ioredis';
import { cacheAside } from '../redis/cache-aside';
import { ProductCard, ProductsRepository } from './products.repository';

export async function readProductCard(
  cache: Redis | null,
  products: ProductsRepository,
  id: number | string,
): Promise<ProductCard | null> {
  const load = () => products.findCard(id);
  if (!cache) return load();
  return cacheAside(cache, `product-card:${id}`, load);
}
