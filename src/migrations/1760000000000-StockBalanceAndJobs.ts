import { MigrationInterface, QueryRunner } from 'typeorm';

export class StockBalanceAndJobs1760000000000 implements MigrationInterface {
  name = 'StockBalanceAndJobs1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "balance" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "CHK_users_balance_nonneg" CHECK ("balance" >= 0)
    `);

    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN "stock" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD CONSTRAINT "CHK_products_stock_nonneg" CHECK ("stock" >= 0)
    `);

    await queryRunner.query(`
      CREATE TABLE "jobs" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "kind" text NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" text NOT NULL DEFAULT 'pending',
        "processed" integer NOT NULL DEFAULT 0,
        "worker_id" text,
        "result" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_jobs_kind_nonempty" CHECK ("kind" <> ''),
        CONSTRAINT "CHK_jobs_status_allowed" CHECK ("status" IN ('pending', 'done')),
        CONSTRAINT "CHK_jobs_processed_nonneg" CHECK ("processed" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "jobs_pending_idx" ON "jobs" ("id")
        WHERE "status" = 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "jobs"`);
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "CHK_products_stock_nonneg"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "stock"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "CHK_users_balance_nonneg"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "balance"`,
    );
  }
}
