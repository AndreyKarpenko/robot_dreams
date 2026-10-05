import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { OrdersRepository, StatusEventRow } from './orders.repository';

describe('OrderEventsService', () => {
  function serviceWith(): {
    service: OrderEventsService;
    release: (value: StatusEventRow[]) => void;
  } {
    let release: (value: StatusEventRow[]) => void = () => undefined;
    const gate = new Promise<StatusEventRow[]>((resolve) => {
      release = resolve;
    });
    const orders = {
      statusEventsSince: () => gate,
    } as unknown as OrdersRepository;
    return { service: new OrderEventsService(orders), release };
  }

  it('keeps a lower id that was still loading when a live event arrived', async () => {
    const { service, release } = serviceWith();
    const seen: number[] = [];
    const pending = service.subscribeOrder(9, 0, (event) => {
      seen.push(event.id);
    });
    service.publish({ id: 2, orderId: 9, status: 'paid' });
    release([
      { id: 1, status: 'created' },
      { id: 2, status: 'paid' },
    ]);
    const stop = await pending;
    expect(seen).toEqual([1, 2]);
    stop();
    service.onModuleDestroy();
  });

  it('replays a persisted id above Last-Event-ID after a new process', async () => {
    const orders = {
      statusEventsSince: (): Promise<StatusEventRow[]> =>
        Promise.resolve([
          { id: 4, status: 'shipped' },
          { id: 6, status: 'paid' },
        ]),
    } as unknown as OrdersRepository;
    const service = new OrderEventsService(orders);
    const seen: OrderStatusEvent[] = [];
    const stop = await service.subscribeOrder(3, 5, (event) => {
      seen.push(event);
    });
    expect(seen).toEqual([{ id: 6, orderId: 3, status: 'paid' }]);
    stop();
    service.onModuleDestroy();
  });
});
