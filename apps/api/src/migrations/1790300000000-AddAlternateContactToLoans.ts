import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-19 — an optional, per-loan alternate contact
// (name + phone number, free-form — not a Client). When set, every
// WhatsApp message about this specific loan goes to this contact instead
// of the client's own number(s). See Loan.alternateContactPhoneNumber's
// own comment. Both nullable, both null on every existing loan — this
// stays an opt-in, rare exception, never the default.
export class AddAlternateContactToLoans1790300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loans" ADD COLUMN "alternate_contact_name" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" ADD COLUMN "alternate_contact_phone_number" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN "alternate_contact_phone_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN "alternate_contact_name"`,
    );
  }
}
