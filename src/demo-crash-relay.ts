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

/**
 * The relay dies between publish and UPDATE published_at by throwing inside
 * the same transaction (the modelled form of that crash, not kill -9).
 * TypeORM rolls the transaction back, so published_at stays NULL, while the
 * broker already has the message. The next poll publishes it again.
 */
async function main(): Promise<void> {
  const world = await openDemoWorld();
  try {
    await prepareBroker();
    await checkout(world.dataSource, {
      buyerId: world.buyerId,
      productId: world.productId,
      quantity: 1,
      idempotencyKey: 'hw22-crash-relay',
    });

    const consumer = startOrderPlacedConsumer({
      store: world.store,
      stopAfter: 2,
    });
    await consumer.subscribed;

    const first = await relayOutbox(world.dataSource, {
      limit: 10,
      crashAfterPublish: true,
    });
    const afterCrash = await demoCounts(world);
    const second = await relayOutbox(world.dataSource, { limit: 10 });
    await withTimeout(consumer.done, 20_000, 'demo:crash-relay');

    const counts = await demoCounts(world);
    const published = first + second;
    report([
      ['published', published],
      ['deliveries', counts.deliveries],
      ['applied', counts.effect],
      ['effect', counts.effect],
      ['processed', counts.processed],
    ]);

    invariant(
      afterCrash.pending === 1,
      `pending after crash=${afterCrash.pending}`,
    );
    invariant(published >= 2, `published=${published}`);
    invariant(counts.deliveries >= 2, `deliveries=${counts.deliveries}`);
    invariant(counts.effect === 1, `effect=${counts.effect}`);
    invariant(counts.processed === 1, `processed=${counts.processed}`);
  } finally {
    await closeDemoWorld(world);
  }
}

void main().catch(failDemo);
