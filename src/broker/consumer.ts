import type { ConsumeMessage } from 'amqplib';
import { getBrokerConnection } from './connection';
import { EffectStore } from './effect-store';
import { parseOrderPlaced } from './order-placed';
import { PREFETCH, WORK_QUEUE } from './topology';

export type ConsumerStats = {
  delivered: number;
  effect: number;
  skipped: number;
  acked: number;
  rejected: number;
  prefetch: number;
  effectMs: number;
};

/**
 * Manual ack after the effect. crashBeforeAck applies the effect and then
 * SIGKILLs the process so the broker sees a dropped socket, not a clean
 * channel.close(), and redelivers the same eventId.
 */
export function startOrderPlacedConsumer(options: {
  store: EffectStore;
  crashBeforeAck?: boolean;
  stopAfter?: number;
}): { subscribed: Promise<void>; done: Promise<ConsumerStats> } {
  let markSubscribed: () => void = () => {};
  const subscribed = new Promise<void>((resolve) => {
    markSubscribed = resolve;
  });

  const done = consume(options, markSubscribed);
  return { subscribed, done };
}

async function consume(
  options: {
    store: EffectStore;
    crashBeforeAck?: boolean;
    stopAfter?: number;
  },
  markSubscribed: () => void,
): Promise<ConsumerStats> {
  const connection = await getBrokerConnection();
  const channel = await connection.createChannel();
  channel.on('error', (err: Error) => {
    console.error(`order.placed consumer: ${err.message}`);
  });
  await channel.prefetch(PREFETCH);

  const stats: ConsumerStats = {
    delivered: 0,
    effect: 0,
    skipped: 0,
    acked: 0,
    rejected: 0,
    prefetch: PREFETCH,
    effectMs: 0,
  };

  return new Promise<ConsumerStats>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(stats);
    };
    const fail = (err: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const maybeFinish = () => {
      if (
        options.stopAfter !== undefined &&
        stats.acked + stats.rejected >= options.stopAfter
      ) {
        finish();
      }
    };

    void channel
      .consume(
        WORK_QUEUE,
        (message: ConsumeMessage | null) => {
          if (!message) {
            return;
          }
          void handle(message).catch(fail);
        },
        { noAck: false },
      )
      .then(() => {
        markSubscribed();
      })
      .catch(fail);

    async function handle(message: ConsumeMessage): Promise<void> {
      stats.delivered += 1;
      const event = parseOrderPlaced(message.content);
      if (!event || event.poison) {
        channel.reject(message, false);
        stats.rejected += 1;
        maybeFinish();
        return;
      }

      await options.store.recordDelivery(event.eventId);
      const started = Date.now();
      const applied = await options.store.applyEffect(
        event.eventId,
        event.data.orderId,
      );
      stats.effectMs += Date.now() - started;
      if (applied) {
        stats.effect += 1;
      } else {
        stats.skipped += 1;
      }

      if (options.crashBeforeAck) {
        process.kill(process.pid, 'SIGKILL');
        await new Promise(() => {});
      }

      channel.ack(message);
      stats.acked += 1;
      maybeFinish();
    }
  });
}
