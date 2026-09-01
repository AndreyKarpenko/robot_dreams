import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/database.module';

@Controller()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      uptime: process.uptime(),
    };
  }

  @Get('db')
  async db() {
    const result = await this.pool.query<{
      current_user: string;
      now: string;
    }>('SELECT current_user, now()::text AS now');
    return result.rows[0];
  }
}
