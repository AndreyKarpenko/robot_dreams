import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, Subscription } from 'rxjs';

export type OrderStatusEvent = {
  id: number;
  orderId: number;
  status: string;
};

const BUFFER_LIMIT = 100;

export function orderRoom(orderId: number): string {
  return `orders:${orderId}`;
}

@Injectable()
export class OrderEventsService implements OnModuleDestroy {
  private readonly subject = new Subject<OrderStatusEvent>();
  private readonly sequences = new Map<number, number>();
  private readonly buffers = new Map<number, OrderStatusEvent[]>();

  /** Live stream. WebSocket forwards this into rooms; SSE uses subscribeOrder. */
  readonly events$: Observable<OrderStatusEvent> = this.subject.asObservable();

  onModuleDestroy(): void {
    this.subject.complete();
  }

  publish(orderId: number, status: string): OrderStatusEvent {
    const id = (this.sequences.get(orderId) ?? 0) + 1;
    this.sequences.set(orderId, id);
    const event: OrderStatusEvent = { id, orderId, status };
    const buffer = this.buffers.get(orderId) ?? [];
    buffer.push(event);
    if (buffer.length > BUFFER_LIMIT) {
      buffer.splice(0, buffer.length - BUFFER_LIMIT);
    }
    this.buffers.set(orderId, buffer);
    this.subject.next(event);
    return event;
  }

  /**
   * Replay events with id > lastEventId, then keep streaming new ones.
   * Subscribing before the replay closes the gap where a publish lands in between.
   */
  subscribeOrder(
    orderId: number,
    lastEventId: number,
    onEvent: (event: OrderStatusEvent) => void,
  ): () => void {
    let cursor = lastEventId;
    const deliver = (event: OrderStatusEvent): void => {
      if (event.orderId !== orderId || event.id <= cursor) {
        return;
      }
      cursor = event.id;
      onEvent(event);
    };

    const subscription: Subscription = this.subject.subscribe(deliver);
    for (const event of this.bufferedSince(orderId, lastEventId)) {
      deliver(event);
    }
    return () => subscription.unsubscribe();
  }

  private bufferedSince(
    orderId: number,
    lastEventId: number,
  ): OrderStatusEvent[] {
    const buffer = this.buffers.get(orderId) ?? [];
    return buffer.filter((event) => event.id > lastEventId);
  }
}
