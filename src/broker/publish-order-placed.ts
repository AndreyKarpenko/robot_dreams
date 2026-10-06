import type { ConfirmChannel, Message } from 'amqplib';
import { brokerConfigured, getBrokerConnection } from './connection';
import type { OrderPlacedEvent } from './order-placed';
import { EVENTS_EXCHANGE, ROUTING_KEY } from './topology';

/**
 * Publish order.placed on one confirm channel for this process.
 * A channel per event would open five channels for five publishes.
 * Does not declare exchanges or queues: the producer does not know its listeners.
 * mandatory + the return handler fail the call when no binding matched,
 * because a confirm alone still arrives for an unroutable message.
 */
export async function publishOrderPlaced(
  event: OrderPlacedEvent,
): Promise<void> {
  if (!brokerConfigured()) {
    return;
  }
  return enqueue(() => publishOnSharedChannel(event));
}

let tail: Promise<void> = Promise.resolve();

/** One in-flight publish. waitForConfirms and basic.return are per channel, not per message. */
function enqueue(task: () => Promise<void>): Promise<void> {
  const run = tail.then(task);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let generation = 0;
let channelSlot: Promise<ConfirmChannel> | null = null;

function confirmChannel(): Promise<ConfirmChannel> {
  if (channelSlot) {
    return channelSlot;
  }
  const gen = ++generation;
  const slot = openConfirmChannel(gen);
  channelSlot = slot;
  void slot.catch(() => {
    dropSlot(gen);
  });
  return slot;
}

function dropSlot(gen: number): void {
  if (generation === gen) {
    channelSlot = null;
  }
}

async function openConfirmChannel(gen: number): Promise<ConfirmChannel> {
  const connection = await getBrokerConnection();
  const channel = await connection.createConfirmChannel();
  channel.on('error', (err: Error) => {
    console.error(`confirm channel: ${err.message}`);
    dropSlot(gen);
  });
  channel.on('close', () => {
    dropSlot(gen);
  });
  return channel;
}

async function publishOnSharedChannel(event: OrderPlacedEvent): Promise<void> {
  const channel = await confirmChannel();
  try {
    await publishConfirmed(channel, event);
  } catch (err) {
    if (err instanceof NotRoutedError) {
      throw err;
    }
    generation += 1;
    channelSlot = null;
    await channel.close().catch(() => undefined);
    throw err;
  }
}

class NotRoutedError extends Error {}

async function publishConfirmed(
  channel: ConfirmChannel,
  event: OrderPlacedEvent,
): Promise<void> {
  const returned: Message[] = [];
  const onReturn = (message: Message) => {
    returned.push(message);
  };
  channel.on('return', onReturn);
  try {
    channel.publish(
      EVENTS_EXCHANGE,
      ROUTING_KEY,
      Buffer.from(JSON.stringify(event)),
      {
        persistent: true,
        mandatory: true,
        contentType: 'application/json',
        messageId: event.eventId,
        type: event.type,
        timestamp: Date.parse(event.occurredAt),
      },
    );
    await channel.waitForConfirms();
  } finally {
    channel.removeListener('return', onReturn);
  }
  if (returned.length > 0) {
    throw new NotRoutedError(
      `order.placed was confirmed but not routed (routing key ${ROUTING_KEY})`,
    );
  }
}
