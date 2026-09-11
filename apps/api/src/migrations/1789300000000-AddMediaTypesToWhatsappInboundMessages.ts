import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-11 — see WhatsappInboundMessageType's own comment.
// Same "widen via drop/recreate" pattern as
// AddHandedOffToHumanConversationMenuValue1786100000000, since Postgres
// won't let a newly-added enum value be used in the same transaction it
// was added in via ALTER TYPE ... ADD VALUE.
const OLD_VALUES = ['button', 'text', 'other'];
const NEW_VALUES = [
  'button',
  'text',
  'image',
  'document',
  'audio',
  'video',
  'sticker',
  'location',
  'other',
];

export class AddMediaTypesToWhatsappInboundMessages1789300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" ALTER COLUMN "type" TYPE varchar USING "type"::text`,
    );
    await queryRunner.query(`DROP TYPE "whatsapp_inbound_messages_type_enum"`);
    await queryRunner.query(
      `CREATE TYPE "whatsapp_inbound_messages_type_enum" AS ENUM (${NEW_VALUES.map((v) => `'${v}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" ALTER COLUMN "type" TYPE "whatsapp_inbound_messages_type_enum" USING "type"::"whatsapp_inbound_messages_type_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Any row already using one of the new values would fail this cast —
    // acceptable for a down migration, same precedent as
    // AddHandedOffToHumanConversationMenuValue1786100000000's own down().
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" ALTER COLUMN "type" TYPE varchar USING "type"::text`,
    );
    await queryRunner.query(`DROP TYPE "whatsapp_inbound_messages_type_enum"`);
    await queryRunner.query(
      `CREATE TYPE "whatsapp_inbound_messages_type_enum" AS ENUM (${OLD_VALUES.map((v) => `'${v}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound_messages" ALTER COLUMN "type" TYPE "whatsapp_inbound_messages_type_enum" USING "type"::"whatsapp_inbound_messages_type_enum"`,
    );
  }
}
