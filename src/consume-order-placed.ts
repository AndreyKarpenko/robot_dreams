import { closeBroker } from './broker/connection';
import { startOrderPlacedConsumer } from './broker/consumer';
import { failDemo, withTimeout } from './broker/demo-support';
import { EffectStore } from './broker/effect-store';

async function main(): Promise<void> {
  const crashBeforeAck = process.argv.includes('--crash-before-ack');
  const store = await EffectStore.open();
  try {
    const consumer = startOrderPlacedConsumer({
      store,
      crashBeforeAck,
      stopAfter: crashBeforeAck ? undefined : 1,
    });
    await withTimeout(consumer.done, 20_000, 'consume-order-placed');
  } finally {
    await closeBroker();
    await store.close();
  }
}

void main().catch(failDemo);
