import { closeBroker, getBrokerConnection } from './broker/connection';
import { startOrderPlacedConsumer } from './broker/consumer';
import { failDemo, withTimeout } from './broker/demo-support';
import { EffectStore } from './broker/effect-store';
import { declareTopology, WORK_QUEUE } from './broker/topology';

async function main(): Promise<void> {
  const crashBeforeAck = process.argv.includes('--crash-before-ack');
  const store = await EffectStore.open();
  try {
    const connection = await getBrokerConnection();
    await declareTopology(connection);
    const consumer = startOrderPlacedConsumer({
      store,
      crashBeforeAck,
    });
    if (crashBeforeAck) {
      await withTimeout(consumer.done, 20_000, 'consume-order-placed');
      return;
    }
    console.error(`order.placed consumer on ${WORK_QUEUE}`);
    process.once('SIGINT', () => {
      void consumer.stop();
    });
    process.once('SIGTERM', () => {
      void consumer.stop();
    });
    await consumer.done;
  } finally {
    await closeBroker();
    await store.close();
  }
}

void main().catch(failDemo);
