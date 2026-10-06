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
  WORK_QUEUE,
  isDeadLetterReason,
  peekDeadLetterReason,
  queueDepth,
  resetTopology,
} from './broker/topology';

async function main(): Promise<void> {
  const store = await EffectStore.open();
  try {
    const connection = await getBrokerConnection();
    await store.reset();
    await resetTopology(connection);

    const consumer = startOrderPlacedConsumer({ store, stopAfter: 1 });
    await consumer.subscribed;
    await publishOrderPlaced(poisonEvent());
    const stats = await withTimeout(consumer.done, 20_000, 'demo:dlq');

    await waitForDeadLetter(connection);
    const reason = await peekDeadLetterReason(connection);
    await waitForDeadLetter(connection);
    const work = await queueDepth(connection, WORK_QUEUE);
    const dlq = await queueDepth(connection, DEAD_LETTER_QUEUE);
    const counts = await store.counts();

    report([
      ['rejected', stats.rejected],
      ['work', work],
      ['dlq', dlq],
      ['dlq-reason', reason ?? 'missing'],
      ['effect', counts.effect],
    ]);

    invariant(stats.rejected === 1, `rejected=${stats.rejected}`);
    invariant(work === 0, `work=${work}`);
    invariant(dlq === 1, `dlq=${dlq}`);
    invariant(
      reason !== undefined && isDeadLetterReason(reason),
      `dlq-reason=${reason ?? 'missing'}`,
    );
    invariant(counts.effect === 0, `effect=${counts.effect}`);
  } finally {
    await closeBroker();
    await store.close();
  }
}

async function waitForDeadLetter(
  connection: Awaited<ReturnType<typeof getBrokerConnection>>,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const depth = await queueDepth(connection, DEAD_LETTER_QUEUE);
    if (depth >= 1) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('dead letter did not arrive');
}

function poisonEvent(): OrderPlacedEvent {
  return {
    eventId: orderPlacedEventId('poison-1'),
    type: 'order.placed',
    occurredAt: new Date().toISOString(),
    poison: true,
    data: {
      orderId: 'poison-1',
      buyerId: 'demo-buyer',
      total: 100,
      items: [{ productId: 'demo-product', quantity: 1, unitPrice: 100 }],
    },
  };
}

void main().catch(failDemo);
