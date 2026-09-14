import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

// Human report, 2026-09-13 — see WhatsappConversationTicket's own comment.
// One row per client, upserted (not append-only) — unlike
// whatsapp_manual_replies/whatsapp_inbound_messages.
export class CreateWhatsappConversationTicketsTable1790400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "whatsapp_conversation_tickets_status_enum" AS ENUM ('pending', 'resolved')`,
    );
    await queryRunner.query(
      `CREATE TYPE "whatsapp_conversation_tickets_trigger_kind_enum" AS ENUM ('advisor_requested', 'receipt_image', 'receipt_document')`,
    );

    await queryRunner.createTable(
      new Table({
        name: 'whatsapp_conversation_tickets',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'client_id',
            type: 'uuid',
            isUnique: true,
          },
          {
            name: 'status',
            type: 'whatsapp_conversation_tickets_status_enum',
          },
          {
            name: 'trigger_kind',
            type: 'whatsapp_conversation_tickets_trigger_kind_enum',
          },
          {
            name: 'pending_since',
            type: 'timestamptz',
          },
          {
            name: 'resolved_at',
            type: 'timestamptz',
            isNullable: true,
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
      'whatsapp_conversation_tickets',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createIndex(
      'whatsapp_conversation_tickets',
      new TableIndex({
        name: 'IDX_whatsapp_conversation_tickets_client_id',
        columnNames: ['client_id'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('whatsapp_conversation_tickets');
    await queryRunner.query(
      `DROP TYPE "whatsapp_conversation_tickets_trigger_kind_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "whatsapp_conversation_tickets_status_enum"`,
    );
  }
}
