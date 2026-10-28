import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refresh-token families and the access-token denylist.
 * The denylist lives in Postgres next to the family so logout is one COMMIT.
 */
export class AuthTokens1762700000000 implements MigrationInterface {
  name = 'AuthTokens1762700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "role" text NOT NULL DEFAULT 'buyer'
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "CHK_users_role_allowed"
        CHECK ("role" IN ('buyer', 'seller', 'admin'))
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "password_hash" text
    `);

    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "token_hash" text NOT NULL,
        "family_id" uuid NOT NULL,
        "user_id" bigint NOT NULL,
        "used_at" TIMESTAMPTZ,
        "revoked_at" TIMESTAMPTZ,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_refresh_tokens_hash_nonempty" CHECK ("token_hash" <> ''),
        CONSTRAINT "refresh_tokens_user_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "refresh_tokens_token_hash_idx"
        ON "refresh_tokens" ("token_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX "refresh_tokens_family_idx"
        ON "refresh_tokens" ("family_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "access_denylist" (
        "jti" text NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_access_denylist" PRIMARY KEY ("jti"),
        CONSTRAINT "CHK_access_denylist_jti_nonempty" CHECK ("jti" <> '')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "access_denylist_expires_idx"
        ON "access_denylist" ("expires_at")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE
            ON TABLE refresh_tokens, access_denylist
            TO app_user;
          GRANT USAGE, SELECT ON SEQUENCE refresh_tokens_id_seq TO app_user;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          REVOKE ALL ON SEQUENCE refresh_tokens_id_seq FROM app_user;
          REVOKE ALL ON TABLE refresh_tokens, access_denylist FROM app_user;
        END IF;
      END $$
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "access_denylist"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "CHK_users_role_allowed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "role"`,
    );
  }
}
