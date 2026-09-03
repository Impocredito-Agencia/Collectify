import { MigrationInterface, QueryRunner } from 'typeorm';

// Bug fix, 2026-09-03 (human report): tapping "Más información" on an
// overdue reminder replied with the client's WHOLE account breakdown
// instead of just the pagaré/installment the reminder was actually about.
// Fixing that requires tracing a button tap back to the exact reminder
// message it replied to — Meta's inbound webhook carries `context.id`
// (the WAMID of the message being replied to) for a quick-reply button
// tap, so this column records the WAMID of every outbound send to match
// against it. See SelfServiceMenuService.sendBreakdownForContext.
export class AddWhatsappMessageIdToMessageLogs1786400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_logs" ADD COLUMN "whatsapp_message_id" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_logs" DROP COLUMN "whatsapp_message_id"`,
    );
  }
}
