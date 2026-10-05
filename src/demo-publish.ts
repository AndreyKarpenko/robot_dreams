import { closeBroker, getBrokerConnection } from './broker/connection';
import { startOrderPlacedConsumer } from './broker/consumer';
import {
  failDemo,
  invariant,
  report,
  withTimeout,
} from './broker/demo-support';
import { EffectStore } from './broker/effect-store';
import {
  orderPlacedEventId,
  type OrderPlacedEvent,
} from './broker/order-placed';
import { publishOrderPlaced } from './broker/publish-order-placed';
import {
  DEAD_LETTER_QUEUE,
  PREFETCH,
  resetTopology,
  queueDepth,
} from './broker/topology';

const PUBLISHED = 5;

async function main(): Promise<void> {
  const store = await EffectStore.open();
  try {
    const connection = await getBrokerConnection();
    await store.reset();
    await resetTopology(connection);

    const consumer = startOrderPlacedConsumer({ store, stopAfter: PUBLISHED });
    await consumer.subscribed;

    for (let index = 1; index <= PUBLISHED; index += 1) {
      await publishOrderPlaced(demoEvent(`publish-${index}`));
    }

    const stats = await withTimeout(consumer.done, 20_000, 'demo:publish');
    const counts = await store.counts();
    const dlq = await queueDepth(connection, DEAD_LETTER_QUEUE);
    const effectMs = stats.effectMs;

    report([
      ['published', PUBLISHED],
      ['delivered', counts.deliveries],
      ['effect', counts.effect],
      ['acked', stats.acked],
      ['dlq', dlq],
      ['prefetch', stats.prefetch],
      ['effect_ms', effectMs],
    ]);

    invariant(PUBLISHED === 5, `published=${PUBLISHED}`);
    invariant(counts.deliveries === 5, `delivered=${counts.deliveries}`);
    invariant(counts.effect === 5, `effect=${counts.effect}`);
    invariant(stats.acked === 5, `acked=${stats.acked}`);
    invariant(dlq === 0, `dlq=${dlq}`);
    invariant(stats.prefetch === PREFETCH, `prefetch=${stats.prefetch}`);
    invariant(
      stats.prefetch >= 1 && stats.prefetch <= 2000,
      'prefetch out of range',
    );
  } finally {
    await closeBroker();
    await store.close();
  }
}

function demoEvent(orderId: string): OrderPlacedEvent {
  return {
    eventId: orderPlacedEventId(orderId),
    type: 'order.placed',
    occurredAt: new Date().toISOString(),
    data: {
      orderId,
      buyerId: 'demo-buyer',
      total: 1500,
      items: [{ productId: 'demo-product', quantity: 1, unitPrice: 1500 }],
    },
  };
}

void main().catch(failDemo);
