import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

// Human report, 2026-09-23 — lets an admin mark ANY inbox conversation as
// closed (green), not only one with a hand-off ticket. See
// WhatsappConversationClosure's own comment. Backfilled from every already-
// resolved ticket so a conversation that shows "Conversación cerrada"
// today keeps doing so after deploy (as long as the client hasn't written
// since — the same read-time rule every closure follows from now on).
export class CreateWhatsappConversationClosuresTable1790900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'whatsapp_conversation_closures',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'contact_key',
            type: 'varchar',
          },
          {
            name: 'closed_at',
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

    await queryRunner.createIndex(
      'whatsapp_conversation_closures',
      new TableIndex({
        name: 'IDX_whatsapp_conversation_closures_contact_key',
        columnNames: ['contact_key'],
        isUnique: true,
      }),
    );

    await queryRunner.query(`
      INSERT INTO whatsapp_conversation_closures (contact_key, closed_at)
      SELECT client_id::text, resolved_at
      FROM whatsapp_conversation_tickets
      WHERE status = 'resolved' AND resolved_at IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('whatsapp_conversation_closures');
  }
}
