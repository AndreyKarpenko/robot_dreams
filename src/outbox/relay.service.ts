import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Env } from '../config/env.schema';
import { PG_POOL } from '../db/database.module';
import { relayOutboxPool } from './relay';

const POLL_MS = 500;

/**
 * Polling relay for the API process. The business transaction only inserts
 * the outbox row; this loop is the other resource manager.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  onModuleInit(): void {
    const url = this.config.get('BROKER_URL', { infer: true });
    if (!url) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await relayOutboxPool(this.pool);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`outbox relay: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
