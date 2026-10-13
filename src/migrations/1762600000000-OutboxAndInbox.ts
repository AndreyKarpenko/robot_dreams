import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Transactional outbox + consumer inbox + API idempotency keys.
 *
 * Column names are snake_case. Debezium's Outbox Event Router defaults to
 * aggregatetype / aggregateid (no underscores) and routes on aggregatetype.
 * A later CDC cutover sets route.by.field=aggregate_type and
 * table.field.event.key=aggregate_id — consumers keep the same payload.
 */
export class OutboxAndInbox1762600000000 implements MigrationInterface {
  name = 'OutboxAndInbox1762600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "outbox" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "aggregate_type" text NOT NULL,
        "aggregate_id" text NOT NULL,
        "type" text NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "published_at" TIMESTAMPTZ,
        "attempts" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_outbox" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_outbox_attempts_nonneg" CHECK ("attempts" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "outbox_unpublished_idx"
        ON "outbox" ("created_at", "id")
        WHERE "published_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "processed_messages" (
        "message_id" text NOT NULL,
        "consumer" text NOT NULL,
        "processed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processed_messages" PRIMARY KEY ("message_id", "consumer")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "idempotency_keys" (
        "key" text NOT NULL,
        "order_id" bigint NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("key"),
        CONSTRAINT "idempotency_keys_order_fk"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE
            ON TABLE outbox, processed_messages, idempotency_keys
            TO app_user;
          GRANT USAGE, SELECT ON SEQUENCE outbox_id_seq TO app_user;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          REVOKE ALL ON SEQUENCE outbox_id_seq FROM app_user;
          REVOKE ALL ON TABLE outbox, processed_messages, idempotency_keys
            FROM app_user;
        END IF;
      END $$
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_keys"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "processed_messages"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "outbox_unpublished_idx"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox"`);
  }
}
