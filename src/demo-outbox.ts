import { checkout } from './checkout';
import { startOrderPlacedConsumer } from './broker/consumer';
import { failDemo, invariant, report, withTimeout } from './broker/demo-support';
import {
  closeDemoWorld,
  demoCounts,
  openDemoWorld,
  prepareBroker,
} from './outbox/demo-world';
import { relayOutbox } from './outbox/relay';

const IDEMPOTENCY_KEY = 'hw22-outbox';

async function main(): Promise<void> {
  const world = await openDemoWorld();
  try {
    await prepareBroker();
    const input = {
      buyerId: world.buyerId,
      productId: world.productId,
      quantity: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
    };
    await checkout(world.dataSource, input);
    await checkout(world.dataSource, input);

    const consumer = startOrderPlacedConsumer({
      store: world.store,
      stopAfter: 1,
    });
    await consumer.subscribed;
    const published = await relayOutbox(world.dataSource, { limit: 10 });
    await withTimeout(consumer.done, 20_000, 'demo:outbox');

    const counts = await demoCounts(world);
    report([
      ['requests', 2],
      ['orders', counts.orders],
      ['outbox', counts.outbox],
      ['published', published],
      ['deliveries', counts.deliveries],
      ['effect', counts.effect],
      ['processed', counts.processed],
    ]);

    invariant(counts.orders === 1, `orders=${counts.orders}`);
    invariant(counts.outbox === 1, `outbox=${counts.outbox}`);
    invariant(published === 1, `published=${published}`);
    invariant(counts.deliveries === 1, `deliveries=${counts.deliveries}`);
    invariant(counts.effect === 1, `effect=${counts.effect}`);
    invariant(counts.processed === 1, `processed=${counts.processed}`);
  } finally {
    await closeDemoWorld(world);
  }
}

void main().catch(failDemo);
