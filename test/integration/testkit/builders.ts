import { randomUUID } from 'node:crypto';

export function aUser(
  overrides: Partial<{ email: string; name: string; balance: number }> = {},
) {
  const id = randomUUID();
  return {
    email: `user-${id}@shop.test`,
    name: `User ${id.slice(0, 8)}`,
    balance: 10_000,
    ...overrides,
  };
}

export function aProduct(
  overrides: { sellerId: string } & Partial<{
    name: string;
    price: number;
    stock: number;
  }>,
) {
  const id = randomUUID();
  return {
    name: `Product ${id}`,
    price: 1299,
    stock: 10,
    ...overrides,
  };
}

export function anOrder(
  overrides: { buyerId: string } & Partial<{
    status: 'created' | 'paid' | 'shipped' | 'cancelled';
    total: number;
  }>,
) {
  return {
    status: 'created' as const,
    total: 0,
    ...overrides,
  };
}
