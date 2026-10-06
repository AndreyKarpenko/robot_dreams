import {
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Env } from '../config/env.schema';
import { PG_POOL } from '../db/database.module';
import { closeBroker, getBrokerConnection } from './connection';
import { startOrderPlacedConsumer } from './consumer';
import { EffectStore } from './effect-store';
import { declareTopology } from './topology';

/**
 * Declares topology and consumes shop.orders.placed for the life of the API.
 * The producer still does not declare queues. Without this consumer the
 * queue is only drained by the demos.
 */
@Injectable()
export class BrokerBootstrap implements OnModuleInit, OnModuleDestroy {
  private consumer: ReturnType<typeof startOrderPlacedConsumer> | null = null;
  private ready = false;
  private stopping = false;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get('BROKER_URL', { infer: true });
    if (!url) {
      return;
    }
    const store = EffectStore.attach(this.pool);
    try {
      const connection = await getBrokerConnection();
      await declareTopology(connection);
      this.consumer = startOrderPlacedConsumer({ store });
      const exited = new Promise<never>((_resolve, reject) => {
        void this.consumer?.done.then(
          () => {
            if (!this.ready) {
              reject(
                new Error('order.placed consumer exited before it subscribed'),
              );
            }
          },
          (err: unknown) => {
            if (!this.ready) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          },
        );
      });
      void exited.catch(() => undefined);
      await Promise.race([this.consumer.subscribed, exited]);
      this.ready = true;
      void this.consumer.done.catch((err: unknown) => {
        if (!this.ready || this.stopping) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error(`order.placed consumer: ${message}`);
      });
    } catch (err) {
      this.stopping = true;
      await this.consumer?.stop();
      await closeBroker();
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.consumer) {
      await this.consumer.stop();
    }
    await closeBroker();
  }
}

@Module({
  providers: [BrokerBootstrap],
})
export class BrokerModule {}
