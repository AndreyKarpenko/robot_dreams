import amqp, { type ChannelModel } from 'amqplib';

let pending: Promise<ChannelModel> | null = null;

export function brokerConfigured(): boolean {
  return (
    typeof process.env.BROKER_URL === 'string' &&
    process.env.BROKER_URL.length > 0
  );
}

export function requireBrokerUrl(): string {
  const url = process.env.BROKER_URL;
  if (!url) {
    throw new Error('BROKER_URL is not set');
  }
  return url;
}

export async function getBrokerConnection(): Promise<ChannelModel> {
  if (!pending) {
    const url = withHeartbeat(requireBrokerUrl());
    pending = amqp.connect(url).then((connection) => {
      const drop = () => {
        pending = null;
      };
      connection.on('error', (err: Error) => {
        console.error(`broker connection: ${err.message}`);
        drop();
      });
      connection.on('close', drop);
      return connection;
    });
    void pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

/** Heartbeat lives in the AMQP URL. The second connect() argument is a socket option. */
function withHeartbeat(url: string): string {
  const parsed = new URL(url);
  if (!parsed.searchParams.has('heartbeat')) {
    parsed.searchParams.set('heartbeat', '10');
  }
  return parsed.toString();
}

export async function closeBroker(): Promise<void> {
  const current = pending;
  pending = null;
  if (!current) {
    return;
  }
  try {
    const connection = await current;
    await connection.close();
  } catch {
    // already closed
  }
}
