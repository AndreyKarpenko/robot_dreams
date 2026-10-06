import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantOrderPlacedEffects1762500000000 implements MigrationInterface {
  name = 'GrantOrderPlacedEffects1762500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE order_placed_effects, order_placed_deliveries
      TO app_user
    `);
    await queryRunner.query(`
      GRANT USAGE, SELECT
      ON SEQUENCE order_placed_deliveries_id_seq
      TO app_user
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      REVOKE ALL ON SEQUENCE order_placed_deliveries_id_seq FROM app_user
    `);
    await queryRunner.query(`
      REVOKE ALL ON TABLE order_placed_effects, order_placed_deliveries
      FROM app_user
    `);
  }
}
