import type { Channel, ChannelModel, Message } from 'amqplib';

/** Topic exchange for domain events. The producer publishes here and does not declare queues. */
export const EVENTS_EXCHANGE = 'shop.events';

/** Dead-letter exchange. The work queue points at it; the producer does not. */
export const DEAD_LETTER_EXCHANGE = 'shop.events.dlx';

export const WORK_QUEUE = 'shop.orders.placed';
export const DEAD_LETTER_QUEUE = 'shop.orders.placed.dlq';
export const ROUTING_KEY = 'order.placed';

/**
 * Unacked messages one consumer may hold.
 * order.placed is one INSERT (~10 ms). 10 × 10 ms is far under consumer_timeout (30 min).
 * The broker default is 0 (unlimited): the first consumer would drain the queue.
 */
export const PREFETCH = 10;

/**
 * Consumer/bootstrap only. A producer that declared this would be naming its listeners.
 * Queue arguments are immutable. The work queue is never deleted: the API consumer
 * is subscribed to it, and queue.delete would cancel that consumer and drop its messages.
 */
export async function declareTopology(connection: ChannelModel): Promise<void> {
  const channel = await connection.createChannel();
  channel.on('error', (err: Error) => {
    console.error(`topology channel: ${err.message}`);
  });
  try {
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', {
      durable: true,
    });
    await channel.assertQueue(DEAD_LETTER_QUEUE, {
      durable: true,
      arguments: {
        'x-queue-type': 'quorum',
      },
    });
    await channel.bindQueue(
      DEAD_LETTER_QUEUE,
      DEAD_LETTER_EXCHANGE,
      ROUTING_KEY,
    );

    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    await channel.assertQueue(WORK_QUEUE, {
      durable: true,
      arguments: {
        'x-queue-type': 'quorum',
        'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
        'x-dead-letter-routing-key': ROUTING_KEY,
      },
    });
    await channel.bindQueue(WORK_QUEUE, EVENTS_EXCHANGE, ROUTING_KEY);
  } finally {
    await channel.close().catch(() => undefined);
  }
}

/**
 * Demo reset. Drops the DLQ and the exchanges so a changed x-argument cannot 406,
 * then declares again. Does not delete WORK_QUEUE: that is the live API queue.
 */
export async function resetTopology(connection: ChannelModel): Promise<void> {
  await deleteQuiet(connection, (channel) =>
    channel.deleteQueue(DEAD_LETTER_QUEUE),
  );
  await deleteQuiet(connection, (channel) =>
    channel.deleteExchange(EVENTS_EXCHANGE),
  );
  await deleteQuiet(connection, (channel) =>
    channel.deleteExchange(DEAD_LETTER_EXCHANGE),
  );
  await declareTopology(connection);
}

export async function queueDepth(
  connection: ChannelModel,
  queue: string,
): Promise<number> {
  const channel = await connection.createChannel();
  try {
    const info = await channel.checkQueue(queue);
    return info.messageCount;
  } finally {
    await channel.close();
  }
}

const DEAD_LETTER_REASONS = new Set([
  'rejected',
  'expired',
  'maxlen',
  'delivery_limit',
]);

export function isDeadLetterReason(value: string): boolean {
  return DEAD_LETTER_REASONS.has(value);
}

/** x-first-death-reason, then the first x-death entry. Both are broker headers. */
export function deathReason(message: Message): string | undefined {
  const headers: unknown = message.properties.headers;
  if (
    headers === null ||
    headers === undefined ||
    typeof headers !== 'object'
  ) {
    return undefined;
  }
  const record = headers as Record<string, unknown>;
  const first = headerString(record['x-first-death-reason']);
  if (first) {
    return first;
  }
  const deaths = record['x-death'];
  if (!Array.isArray(deaths) || deaths.length === 0) {
    return undefined;
  }
  const entry: unknown = deaths[0];
  if (entry === null || typeof entry !== 'object') {
    return undefined;
  }
  return headerString((entry as Record<string, unknown>).reason);
}

/**
 * Read one DLQ message and put it back, so the depth at the end of the demo stays 1.
 * nack(requeue=true) does not bump the quorum delivery count.
 */
export async function peekDeadLetterReason(
  connection: ChannelModel,
): Promise<string | undefined> {
  const channel = await connection.createChannel();
  try {
    const message = await channel.get(DEAD_LETTER_QUEUE, { noAck: false });
    if (message === false) {
      return undefined;
    }
    const reason = deathReason(message);
    channel.nack(message, false, true);
    return reason;
  } finally {
    await channel.close();
  }
}

function headerString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8');
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

async function deleteQuiet(
  connection: ChannelModel,
  op: (channel: Channel) => Promise<unknown>,
): Promise<void> {
  const channel = await connection.createChannel();
  channel.on('error', (err: Error) => {
    if (!/NOT_FOUND/.test(err.message)) {
      console.error(`broker delete: ${err.message}`);
    }
  });
  try {
    await op(channel);
    await channel.close();
  } catch {
    // 404 closes the channel; the object was already gone.
  }
}
