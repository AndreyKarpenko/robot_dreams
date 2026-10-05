import type { ConfirmChannel, Message } from 'amqplib';
import { brokerConfigured, getBrokerConnection } from './connection';
import type { OrderPlacedEvent } from './order-placed';
import { EVENTS_EXCHANGE, ROUTING_KEY } from './topology';

/**
 * Publish order.placed on a confirm channel.
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
  const connection = await getBrokerConnection();
  const channel = await connection.createConfirmChannel();
  try {
    await publishConfirmed(channel, event);
  } finally {
    await channel.close();
  }
}

async function publishConfirmed(
  channel: ConfirmChannel,
  event: OrderPlacedEvent,
): Promise<void> {
  const returned: Message[] = [];
  const onReturn = (message: Message) => {
    returned.push(message);
  };
  channel.on('return', onReturn);
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
  channel.removeListener('return', onReturn);
  if (returned.length > 0) {
    throw new Error(
      `order.placed was confirmed but not routed (routing key ${ROUTING_KEY})`,
    );
  }
}
