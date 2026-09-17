import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-16 — neither message_logs nor whatsapp_manual_replies
// tracked anything past the synchronous send-attempt outcome (their existing
// `status` column: did the HTTP call to Meta's Send API return 200). Meta's
// webhook also delivers a `statuses[]` callback per message (sent/delivered/
// read/failed, plus an error code on failure) that was never parsed at all —
// see extractStatusEvents.ts. This adds columns to record that callback,
// correlated back to the send via whatsapp_message_id (Meta's WAMID).
// whatsapp_manual_replies didn't have a whatsapp_message_id column at all
// (unlike message_logs, added 2026-09-03) since nothing needed it before now.
export class AddDeliveryStatusTrackingToOutboundMessages1790800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "message_logs_delivery_status_enum" AS ENUM ('sent', 'delivered', 'read', 'failed')`,
    );
    await queryRunner.query(`
      ALTER TABLE "message_logs"
      ADD COLUMN "delivery_status" "message_logs_delivery_status_enum",
      ADD COLUMN "delivery_status_updated_at" TIMESTAMPTZ,
      ADD COLUMN "last_error_code" integer,
      ADD COLUMN "last_error_title" varchar
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_message_logs_whatsapp_message_id" ON "message_logs" ("whatsapp_message_id")`,
    );

    await queryRunner.query(
      `CREATE TYPE "whatsapp_manual_replies_delivery_status_enum" AS ENUM ('sent', 'delivered', 'read', 'failed')`,
    );
    await queryRunner.query(`
      ALTER TABLE "whatsapp_manual_replies"
      ADD COLUMN "whatsapp_message_id" varchar,
      ADD COLUMN "delivery_status" "whatsapp_manual_replies_delivery_status_enum",
      ADD COLUMN "delivery_status_updated_at" TIMESTAMPTZ,
      ADD COLUMN "last_error_code" integer,
      ADD COLUMN "last_error_title" varchar
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_manual_replies_whatsapp_message_id" ON "whatsapp_manual_replies" ("whatsapp_message_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_whatsapp_manual_replies_whatsapp_message_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "whatsapp_manual_replies"
      DROP COLUMN "last_error_title",
      DROP COLUMN "last_error_code",
      DROP COLUMN "delivery_status_updated_at",
      DROP COLUMN "delivery_status",
      DROP COLUMN "whatsapp_message_id"
    `);
    await queryRunner.query(
      `DROP TYPE "whatsapp_manual_replies_delivery_status_enum"`,
    );

    await queryRunner.query(
      `DROP INDEX "IDX_message_logs_whatsapp_message_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "message_logs"
      DROP COLUMN "last_error_title",
      DROP COLUMN "last_error_code",
      DROP COLUMN "delivery_status_updated_at",
      DROP COLUMN "delivery_status"
    `);
    await queryRunner.query(`DROP TYPE "message_logs_delivery_status_enum"`);
  }
}
