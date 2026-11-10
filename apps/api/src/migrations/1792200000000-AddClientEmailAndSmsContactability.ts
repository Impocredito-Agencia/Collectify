import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

// Phase 36, stage 4 — Brevo's delivery webhook marks a client's email, or
// one of their phone numbers, as not contactable after a definitive
// failure (confirmed with the human): email — hard bounce, invalid,
// blocked, spam, unsubscribed; SMS — hard bounce, blacklisted, STOP. The
// email/SMS reminders skip them until the admin re-enables them. WhatsApp
// is never affected. See docs/phases/PHASE_36_BREVO_EMAIL_SMS.md.
export class AddClientEmailAndSmsContactability1792200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('clients', [
      new TableColumn({
        name: 'email_undeliverable_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'email_undeliverable_reason',
        type: 'varchar',
        isNullable: true,
      }),
      new TableColumn({
        name: 'sms_undeliverable_phone_numbers',
        type: 'text',
        isArray: true,
        default: `'{}'`,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('clients', 'sms_undeliverable_phone_numbers');
    await queryRunner.dropColumn('clients', 'email_undeliverable_reason');
    await queryRunner.dropColumn('clients', 'email_undeliverable_at');
  }
}
