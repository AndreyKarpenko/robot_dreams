import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, Subscription } from 'rxjs';
import { OrdersRepository } from './orders.repository';

export type OrderStatusEvent = {
  id: number;
  orderId: number;
  status: string;
};

export function orderRoom(orderId: number): string {
  return `orders:${orderId}`;
}

@Injectable()
export class OrderEventsService implements OnModuleDestroy {
  private readonly subject = new Subject<OrderStatusEvent>();

  /** Live stream. WebSocket forwards this into rooms; SSE replays from the log, then this. */
  readonly events$: Observable<OrderStatusEvent> = this.subject.asObservable();

  constructor(private readonly orders: OrdersRepository) {}

  onModuleDestroy(): void {
    this.subject.complete();
  }

  /** Fan out an event whose id was already allocated in `orders.event_seq`. */
  publish(event: OrderStatusEvent): void {
    this.subject.next(event);
  }

  /**
   * Replay rows with id > lastEventId, then keep streaming new ones.
   * Live events that land while the log is loading stay queued so a higher
   * id cannot move the cursor past a row that has not been sent yet.
   */
  async subscribeOrder(
    orderId: number,
    lastEventId: number,
    onEvent: (event: OrderStatusEvent) => void,
  ): Promise<() => void> {
    let cursor = lastEventId;
    const pending: OrderStatusEvent[] = [];
    let replaying = true;

    const deliver = (event: OrderStatusEvent): void => {
      if (event.orderId !== orderId || event.id <= cursor) {
        return;
      }
      cursor = event.id;
      onEvent(event);
    };

    const subscription: Subscription = this.subject.subscribe((event) => {
      if (event.orderId !== orderId) {
        return;
      }
      if (replaying) {
        pending.push(event);
        return;
      }
      deliver(event);
    });

    try {
      const missed = await this.orders.statusEventsSince(orderId, lastEventId);
      for (const row of missed) {
        deliver({ id: row.id, orderId, status: row.status });
      }
      replaying = false;
      for (const event of pending) {
        deliver(event);
      }
    } catch (err) {
      subscription.unsubscribe();
      throw err;
    }

    return () => subscription.unsubscribe();
  }
}
