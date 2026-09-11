import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-11 — lets a WhatsApp comprobante be traced to the
// exact payment it produced, once a collector reviews it and registers
// the payment from the inbox (see WhatsappInboundMessage.paymentId's own
// comment and InstallmentsService.registerPayment).
export class AddPaymentIdToWhatsappInboundMessages1789700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" ADD COLUMN "payment_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" ADD CONSTRAINT "FK_whatsapp_inbound_messages_payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" DROP CONSTRAINT "FK_whatsapp_inbound_messages_payment_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" DROP COLUMN "payment_id"`,
    );
  }
}
