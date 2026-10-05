import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderPlacedEffects1762400000000 implements MigrationInterface {
  name = 'OrderPlacedEffects1762400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_placed_effects" (
        "event_id" text NOT NULL,
        "order_id" text NOT NULL,
        "applied_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_placed_effects" PRIMARY KEY ("event_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_placed_deliveries" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "event_id" text NOT NULL,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_placed_deliveries" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_placed_deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_placed_effects"`);
  }
}
