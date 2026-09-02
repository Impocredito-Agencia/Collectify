import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 34 follow-up (2026-09-02) — see the ConversationMenu doc comment in
// apps/api/src/whatsapp/entities/whatsappConversationState.entity.ts. Same
// "widen via drop/recreate" pattern used elsewhere in this codebase, since
// Postgres won't let a newly-added enum value be used in the same
// transaction it was added in via ALTER TYPE ... ADD VALUE.
const OLD_VALUES = ['main', 'mi_cuenta_submenu', 'awaiting_receipt'];
const NEW_VALUES = [...OLD_VALUES, 'handed_off_to_human'];

export class AddHandedOffToHumanConversationMenuValue1786100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_conversation_states" ALTER COLUMN "current_menu" TYPE varchar USING "current_menu"::text`,
    );
    await queryRunner.query(
      `DROP TYPE "whatsapp_conversation_states_current_menu_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "whatsapp_conversation_states_current_menu_enum" AS ENUM (${NEW_VALUES.map((v) => `'${v}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_conversation_states" ALTER COLUMN "current_menu" TYPE "whatsapp_conversation_states_current_menu_enum" USING "current_menu"::"whatsapp_conversation_states_current_menu_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Any row already using the new value would fail this cast — acceptable
    // for a down migration (matches this repo's other enum-widening
    // migrations, e.g. MessageTemplateCatalogV2's down()).
    await queryRunner.query(
      `ALTER TABLE "whatsapp_conversation_states" ALTER COLUMN "current_menu" TYPE varchar USING "current_menu"::text`,
    );
    await queryRunner.query(
      `DROP TYPE "whatsapp_conversation_states_current_menu_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "whatsapp_conversation_states_current_menu_enum" AS ENUM (${OLD_VALUES.map((v) => `'${v}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_conversation_states" ALTER COLUMN "current_menu" TYPE "whatsapp_conversation_states_current_menu_enum" USING "current_menu"::"whatsapp_conversation_states_current_menu_enum"`,
    );
  }
}
