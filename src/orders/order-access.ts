import { OrdersRepository } from './orders.repository';

export type OrderAccess =
  | { ok: true }
  | { ok: false; error: 'unauthorized' | 'not_found' | 'forbidden' };

/** Same gate for the socket room and the SSE stream. */
export async function checkOrderOwner(
  orders: OrdersRepository,
  orderId: number,
  userId: string | undefined,
): Promise<OrderAccess> {
  if (!userId) {
    return { ok: false, error: 'unauthorized' };
  }

  const found = await orders.findByIdWithItems(orderId);
  if (!found) {
    return { ok: false, error: 'not_found' };
  }
  if (String(found.order.buyer_id) !== userId) {
    return { ok: false, error: 'forbidden' };
  }
  return { ok: true };
}
