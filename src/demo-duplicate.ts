import { spawn } from 'node:child_process';
import { join } from 'node:path';
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
import { WORK_QUEUE, queueDepth, resetTopology } from './broker/topology';

async function main(): Promise<void> {
  const store = await EffectStore.open();
  try {
    const connection = await getBrokerConnection();
    await store.reset();
    await resetTopology(connection);
    await publishOrderPlaced(demoEvent());

    const crash = await killConsumerBeforeAck();
    invariant(
      crash.signal === 'SIGKILL',
      `consumer signal=${crash.signal ?? 'none'} code=${crash.code ?? 'none'}`,
    );

    const consumer = startOrderPlacedConsumer({ store, stopAfter: 1 });
    await consumer.subscribed;
    await withTimeout(consumer.done, 20_000, 'redelivery');

    const counts = await store.counts();
    const work = await queueDepth(connection, WORK_QUEUE);
    const skipped = counts.deliveries - counts.effect;

    report([
      ['deliveries', counts.deliveries],
      ['effect', counts.effect],
      ['skipped', skipped],
    ]);

    invariant(counts.deliveries >= 2, `deliveries=${counts.deliveries}`);
    invariant(counts.effect === 1, `effect=${counts.effect}`);
    invariant(skipped >= 1, `skipped=${skipped}`);
    invariant(work === 0, `work=${work}`);
  } finally {
    await closeBroker();
    await store.close();
  }
}

function killConsumerBeforeAck(): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}> {
  const child = spawn(
    process.execPath,
    [join(__dirname, 'consume-order-placed.js'), '--crash-before-ack'],
    { env: process.env, stdio: 'inherit' },
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('consumer did not die after the effect'));
    }, 20_000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function demoEvent(): OrderPlacedEvent {
  return {
    eventId: orderPlacedEventId('duplicate-1'),
    type: 'order.placed',
    occurredAt: new Date().toISOString(),
    data: {
      orderId: 'duplicate-1',
      buyerId: 'demo-buyer',
      total: 2500,
      items: [{ productId: 'demo-product', quantity: 2, unitPrice: 1250 }],
    },
  };
}

void main().catch(failDemo);
