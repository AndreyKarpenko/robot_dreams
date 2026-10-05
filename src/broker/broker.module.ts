import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp from 'amqplib';
import type { Env } from '../config/env.schema';
import { declareTopology } from './topology';

/**
 * Bootstrap step, not the producer. Declares the exchange, the queue, the
 * binding and the dead-letter contour before any order.placed is published.
 */
@Injectable()
export class BrokerBootstrap implements OnModuleInit {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get('BROKER_URL', { infer: true });
    if (!url) {
      return;
    }
    const parsed = new URL(url);
    if (!parsed.searchParams.has('heartbeat')) {
      parsed.searchParams.set('heartbeat', '10');
    }
    const connection = await amqp.connect(parsed.toString());
    try {
      await declareTopology(connection);
    } finally {
      await connection.close();
    }
  }
}

@Module({
  providers: [BrokerBootstrap],
})
export class BrokerModule {}
