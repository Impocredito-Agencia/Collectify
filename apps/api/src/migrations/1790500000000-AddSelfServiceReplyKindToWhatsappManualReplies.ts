import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-13 — WhatsappOutboundLogService's log() covers
// BOTH the self-service menu's own automated replies AND
// WhatsappWebhookService.closeConversation's closing message, told apart
// today only by `sentByUserId: null` for both. Nullable — set only for a
// self-service-menu send (see SelfServiceMenuService's sendText/
// sendInteractive wrappers); null for an admin's own typed reply or the
// closing message, same as before this column existed.
export class AddSelfServiceReplyKindToWhatsappManualReplies1790500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "whatsapp_manual_replies_self_service_reply_kind_enum" AS ENUM ('main_menu', 'mi_cuenta_submenu', 'breakdown', 'payment_history', 'receipt_request', 'receipt_received_ack', 'advisor_handoff', 'volver_al_menu_follow_up')`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_manual_replies" ADD "self_service_reply_kind" "whatsapp_manual_replies_self_service_reply_kind_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_manual_replies" DROP COLUMN "self_service_reply_kind"`,
    );
    await queryRunner.query(
      `DROP TYPE "whatsapp_manual_replies_self_service_reply_kind_enum"`,
    );
  }
}
