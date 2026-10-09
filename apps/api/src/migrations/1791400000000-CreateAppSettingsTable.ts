import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

// Human request, 2026-10-09 — backs the admin-editable bank account the
// cuenta_bancaria WhatsApp template sends. See AppSetting's own comment.
// Starts empty on purpose: the account is entered from the panel, and the
// send is blocked until it is.
export class CreateAppSettingsTable1791400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'app_settings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'key',
            type: 'varchar',
          },
          {
            name: 'value',
            type: 'text',
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'app_settings',
      new TableIndex({
        name: 'IDX_app_settings_key',
        columnNames: ['key'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('app_settings');
  }
}
