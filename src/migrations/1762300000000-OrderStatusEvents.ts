import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderStatusEvents1762300000000 implements MigrationInterface {
  name = 'OrderStatusEvents1762300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "event_seq" bigint NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "CHK_orders_event_seq_nonneg" CHECK ("event_seq" >= 0)
    `);
    await queryRunner.query(`
      CREATE TABLE "order_status_events" (
        "order_id" bigint NOT NULL,
        "id" bigint NOT NULL,
        "status" text NOT NULL,
        CONSTRAINT "PK_order_status_events" PRIMARY KEY ("order_id", "id"),
        CONSTRAINT "CHK_order_status_events_id_positive" CHECK ("id" >= 1),
        CONSTRAINT "CHK_order_status_events_status_allowed"
          CHECK ("status" IN ('created', 'paid', 'shipped', 'cancelled')),
        CONSTRAINT "order_status_events_order_fk"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_status_events"`);
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "CHK_orders_event_seq_nonneg"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "event_seq"`,
    );
  }
}
