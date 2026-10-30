import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The file list lives in Postgres, not in a bucket listing.
 * key is server-generated. upload_id is set only for multipart.
 */
export class Files1762800000000 implements MigrationInterface {
  name = 'Files1762800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "files" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "key" text NOT NULL,
        "owner_id" bigint NOT NULL,
        "status" text NOT NULL DEFAULT 'PENDING',
        "size" bigint NOT NULL,
        "upload_id" text,
        "content_type" text NOT NULL,
        "idempotency_key" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_files" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_files_key" UNIQUE ("key"),
        CONSTRAINT "CHK_files_key_nonempty" CHECK ("key" <> ''),
        CONSTRAINT "CHK_files_key_relative" CHECK ("key" !~ '^/'),
        CONSTRAINT "CHK_files_key_no_traversal" CHECK ("key" !~ '(^|/)\\.\\.(/|$)'),
        CONSTRAINT "CHK_files_status_allowed" CHECK ("status" IN ('PENDING', 'COMPLETED')),
        CONSTRAINT "CHK_files_size_positive" CHECK ("size" > 0),
        CONSTRAINT "CHK_files_content_type_nonempty" CHECK ("content_type" <> ''),
        CONSTRAINT "files_owner_fk"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "files_owner_idempotency_idx"
        ON "files" ("owner_id", "idempotency_key")
        WHERE "idempotency_key" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "files_pending_created_idx"
        ON "files" ("created_at")
        WHERE "status" = 'PENDING'
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE files TO app_user;
          GRANT USAGE, SELECT ON SEQUENCE files_id_seq TO app_user;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "files"`);
  }
}
