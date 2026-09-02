import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

// Phase 34 — see docs/phases/PHASE_34_INTERACTIVE_MENU.md. Ephemeral
// per-phone-number conversation state for the self-service menu: which
// screen a client is currently on, expiring with the 24h session window.
// Unlike whatsapp_inbound_messages this is not append-only — one row per
// phone number, upserted on every relevant inbound event.
export class CreateWhatsappConversationStatesTable1786000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "whatsapp_conversation_states_current_menu_enum" AS ENUM('main', 'mi_cuenta_submenu', 'awaiting_receipt')`,
    );

    await queryRunner.createTable(
      new Table({
        name: 'whatsapp_conversation_states',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'phone_number',
            type: 'varchar',
            isUnique: true,
          },
          {
            name: 'client_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'current_menu',
            type: 'whatsapp_conversation_states_current_menu_enum',
          },
          {
            name: 'expires_at',
            type: 'timestamptz',
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

    await queryRunner.createForeignKey(
      'whatsapp_conversation_states',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createIndex(
      'whatsapp_conversation_states',
      new TableIndex({
        name: 'IDX_whatsapp_conversation_states_client_id',
        columnNames: ['client_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('whatsapp_conversation_states');
    await queryRunner.query(
      `DROP TYPE "whatsapp_conversation_states_current_menu_enum"`,
    );
  }
}
