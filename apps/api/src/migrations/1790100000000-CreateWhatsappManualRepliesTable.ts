import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-19 — see WhatsappManualReply's own comment.
export class CreateWhatsappManualRepliesTable1790100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "whatsapp_manual_replies_status_enum" AS ENUM ('sent', 'failed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "whatsapp_manual_replies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "client_id" uuid,
        "phone_number" varchar NOT NULL,
        "message_content" text NOT NULL,
        "sent_by_user_id" uuid,
        "status" "whatsapp_manual_replies_status_enum" NOT NULL,
        "sent_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_whatsapp_manual_replies" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_manual_replies_client_id" ON "whatsapp_manual_replies" ("client_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_manual_replies_sent_by_user_id" ON "whatsapp_manual_replies" ("sent_by_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_manual_replies" ADD CONSTRAINT "FK_whatsapp_manual_replies_client_id" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_manual_replies" ADD CONSTRAINT "FK_whatsapp_manual_replies_sent_by_user_id" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "whatsapp_manual_replies"`);
    await queryRunner.query(`DROP TYPE "whatsapp_manual_replies_status_enum"`);
  }
}
