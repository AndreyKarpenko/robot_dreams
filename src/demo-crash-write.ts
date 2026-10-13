import { checkout } from './checkout';
import { BusinessWriteCrashedError } from './checkout-errors';
import { failDemo, invariant, report } from './broker/demo-support';
import {
  closeDemoWorld,
  demoCounts,
  openDemoWorld,
} from './outbox/demo-world';

async function main(): Promise<void> {
  const world = await openDemoWorld();
  try {
    let writeFailed = 0;
    try {
      await checkout(
        world.dataSource,
        {
          buyerId: world.buyerId,
          productId: world.productId,
          quantity: 1,
        },
        { crashAfterOutbox: true },
      );
    } catch (err) {
      if (!(err instanceof BusinessWriteCrashedError)) {
        throw err;
      }
      writeFailed = 1;
    }

    const counts = await demoCounts(world);
    report([
      ['write-failed', writeFailed],
      ['orders', counts.orders],
      ['outbox', counts.outbox],
      ['published', 0],
      ['deliveries', counts.deliveries],
      ['effect', counts.effect],
    ]);

    invariant(writeFailed === 1, `write-failed=${writeFailed}`);
    invariant(counts.orders === 0, `orders=${counts.orders}`);
    invariant(counts.outbox === 0, `outbox=${counts.outbox}`);
    invariant(counts.deliveries === 0, `deliveries=${counts.deliveries}`);
    invariant(counts.effect === 0, `effect=${counts.effect}`);
    invariant(counts.pending === 0, `pending=${counts.pending}`);
  } finally {
    await closeDemoWorld(world);
  }
}

void main().catch(failDemo);
