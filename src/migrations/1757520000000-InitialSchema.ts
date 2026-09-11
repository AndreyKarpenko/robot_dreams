import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1757520000000 implements MigrationInterface {
  name = 'InitialSchema1757520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "email" text NOT NULL,
        "name" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_users_email_nonempty" CHECK ("email" <> ''),
        CONSTRAINT "CHK_users_email_shaped" CHECK ("email" LIKE '%@%'),
        CONSTRAINT "CHK_users_name_nonempty" CHECK ("name" <> '')
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (lower("email"))`,
    );

    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "name" text NOT NULL,
        "price" integer NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "seller_id" bigint NOT NULL,
        CONSTRAINT "PK_products" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_products_name_nonempty" CHECK ("name" <> ''),
        CONSTRAINT "CHK_products_price_nonneg" CHECK ("price" >= 0),
        CONSTRAINT "products_seller_fk"
          FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "status" text NOT NULL,
        "total" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "buyer_id" bigint NOT NULL,
        CONSTRAINT "PK_orders" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_orders_status_allowed"
          CHECK ("status" IN ('created', 'paid', 'shipped', 'cancelled')),
        CONSTRAINT "CHK_orders_total_nonneg" CHECK ("total" >= 0),
        CONSTRAINT "orders_buyer_fk"
          FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "orders_buyer_created_idx" ON "orders" ("buyer_id", "created_at" DESC)`,
    );
    await queryRunner.query(`
      CREATE INDEX "orders_queue_recent_idx"
        ON "orders" ("status", "created_at" DESC)
        INCLUDE ("id", "buyer_id", "total")
        WHERE "status" IN ('created', 'cancelled')
    `);

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "quantity" integer NOT NULL,
        "unit_price" integer NOT NULL,
        "order_id" bigint NOT NULL,
        "product_id" bigint NOT NULL,
        CONSTRAINT "PK_order_items" PRIMARY KEY ("id"),
        CONSTRAINT "order_items_order_product_key" UNIQUE ("order_id", "product_id"),
        CONSTRAINT "CHK_order_items_qty_positive" CHECK ("quantity" >= 1),
        CONSTRAINT "CHK_order_items_price_nonneg" CHECK ("unit_price" >= 0),
        CONSTRAINT "order_items_order_fk"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "order_items_product_fk"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_items"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "orders_queue_recent_idx"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "orders_buyer_created_idx"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "users_email_lower_idx"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
