import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-14 — see WhatsappTicketTriggerKind's own comment.
// Same "widen via drop/recreate" pattern as
// AddHandedOffToHumanConversationMenuValue, since Postgres won't let a
// newly-added enum value be used in the same transaction it was added in
// via ALTER TYPE ... ADD VALUE.
const OLD_VALUES = ['advisor_requested', 'receipt_image', 'receipt_document'];
const NEW_VALUES = [...OLD_VALUES, 'free_text'];

export class AddFreeTextTicketTriggerKindValue1790600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_conversation_tickets" ALTER COLUMN "trigger_kind" TYPE varchar USING "trigger_kind"::text`,
    );
    await queryRunner.query(
      `DROP TYPE "whatsapp_conversation_tickets_trigger_kind_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "whatsapp_conversation_tickets_trigger_kind_enum" AS ENUM (${NEW_VALUES.map((v) => `'${v}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_conversation_tickets" ALTER COLUMN "trigger_kind" TYPE "whatsapp_conversation_tickets_trigger_kind_enum" USING "trigger_kind"::"whatsapp_conversation_tickets_trigger_kind_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Any row already using the new value would fail this cast — acceptable
    // for a down migration, same precedent as this repo's other
    // enum-widening migrations.
    await queryRunner.query(
      `ALTER TABLE "whatsapp_conversation_tickets" ALTER COLUMN "trigger_kind" TYPE varchar USING "trigger_kind"::text`,
    );
    await queryRunner.query(
      `DROP TYPE "whatsapp_conversation_tickets_trigger_kind_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "whatsapp_conversation_tickets_trigger_kind_enum" AS ENUM (${OLD_VALUES.map((v) => `'${v}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_conversation_tickets" ALTER COLUMN "trigger_kind" TYPE "whatsapp_conversation_tickets_trigger_kind_enum" USING "trigger_kind"::"whatsapp_conversation_tickets_trigger_kind_enum"`,
    );
  }
}
