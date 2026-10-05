/**
 * Contract for order.placed. eventId is stable for the business operation
 * (the order), so a redelivery is the same event and not a second order.
 * poison is only the DLQ demo; it is not part of the domain payload.
 */
export type OrderPlacedEvent = {
  eventId: string;
  type: 'order.placed';
  occurredAt: string;
  data: {
    orderId: string;
    buyerId: string;
    total: number;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
    }>;
  };
  poison?: boolean;
};

export function orderPlacedEventId(orderId: string): string {
  return `order.placed:${orderId}`;
}

export function parseOrderPlaced(content: Buffer): OrderPlacedEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    return null;
  }
  if (!isOrderPlaced(value)) {
    return null;
  }
  return value;
}

function isOrderPlaced(value: unknown): value is OrderPlacedEvent {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const event = value as Record<string, unknown>;
  if (typeof event.eventId !== 'string' || event.eventId.length === 0) {
    return false;
  }
  if (event.type !== 'order.placed') {
    return false;
  }
  if (typeof event.occurredAt !== 'string') {
    return false;
  }
  if (event.poison !== undefined && typeof event.poison !== 'boolean') {
    return false;
  }
  const data = event.data;
  if (data === null || typeof data !== 'object') {
    return false;
  }
  const body = data as Record<string, unknown>;
  if (typeof body.orderId !== 'string' || typeof body.buyerId !== 'string') {
    return false;
  }
  if (typeof body.total !== 'number' || !Number.isFinite(body.total)) {
    return false;
  }
  if (!Array.isArray(body.items)) {
    return false;
  }
  return body.items.every((item: unknown) => {
    if (item === null || typeof item !== 'object') {
      return false;
    }
    const line = item as Record<string, unknown>;
    return (
      typeof line.productId === 'string' &&
      typeof line.quantity === 'number' &&
      typeof line.unitPrice === 'number'
    );
  });
}
