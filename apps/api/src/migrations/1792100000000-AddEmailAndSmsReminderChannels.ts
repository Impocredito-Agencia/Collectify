import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from 'typeorm';

// Phase 36, stage 3 — email and SMS reminders, sent on top of WhatsApp to
// the clients the admin picks. See docs/phases/PHASE_36_BREVO_EMAIL_SMS.md.
//
// - message_logs: which channel a row went out through (every existing row
//   is WhatsApp), the email recipient, and Brevo's message id. phone_number
//   becomes nullable — an email row has none — with a CHECK keeping the
//   right recipient set for each channel.
// - clients: the two per-client switches, off for everyone.
// - message_channel_schedules: one schedule per (family, channel), seeded
//   paused with the same default times as the WhatsApp families.

const CHANNEL_SCHEDULE_SEEDS: {
  family: string;
  cronExpression: string;
}[] = [
  { family: 'overdue', cronExpression: '0 9 * * 1' },
  { family: 'upcoming_due', cronExpression: '0 8 * * *' },
  { family: 'credit_report', cronExpression: '0 9 * * *' },
];

export class AddEmailAndSmsReminderChannels1792100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "message_logs_channel_enum" AS ENUM ('whatsapp', 'email', 'sms')`,
    );
    await queryRunner.addColumns('message_logs', [
      new TableColumn({
        name: 'channel',
        type: 'message_logs_channel_enum',
        default: `'whatsapp'`,
      }),
      new TableColumn({ name: 'email', type: 'varchar', isNullable: true }),
      new TableColumn({
        name: 'provider_message_id',
        type: 'varchar',
        isNullable: true,
      }),
    ]);
    await queryRunner.query(
      `ALTER TABLE "message_logs" ALTER COLUMN "phone_number" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_logs" ADD CONSTRAINT "CHK_message_logs_recipient" CHECK (
        ("channel" = 'email' AND "email" IS NOT NULL)
        OR ("channel" <> 'email' AND "phone_number" IS NOT NULL)
      )`,
    );
    await queryRunner.createIndex(
      'message_logs',
      new TableIndex({
        name: 'IDX_message_logs_provider_message_id',
        columnNames: ['provider_message_id'],
      }),
    );

    await queryRunner.addColumns('clients', [
      new TableColumn({
        name: 'email_reminders_enabled',
        type: 'boolean',
        default: false,
      }),
      new TableColumn({
        name: 'sms_reminders_enabled',
        type: 'boolean',
        default: false,
      }),
    ]);

    await queryRunner.query(
      `CREATE TYPE "message_channel_schedules_family_enum" AS ENUM ('overdue', 'upcoming_due', 'credit_report')`,
    );
    await queryRunner.query(
      `CREATE TYPE "message_channel_schedules_channel_enum" AS ENUM ('email', 'sms')`,
    );
    await queryRunner.createTable(
      new Table({
        name: 'message_channel_schedules',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'family', type: 'message_channel_schedules_family_enum' },
          { name: 'channel', type: 'message_channel_schedules_channel_enum' },
          { name: 'cron_expression', type: 'varchar' },
          { name: 'is_paused', type: 'boolean', default: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'message_channel_schedules',
      new TableIndex({
        name: 'IDX_message_channel_schedules_family_channel',
        columnNames: ['family', 'channel'],
        isUnique: true,
      }),
    );
    for (const seed of CHANNEL_SCHEDULE_SEEDS) {
      await queryRunner.query(
        `INSERT INTO "message_channel_schedules" ("family", "channel", "cron_expression")
         VALUES ($1, 'email', $2), ($1, 'sms', $2)`,
        [seed.family, seed.cronExpression],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('message_channel_schedules');
    await queryRunner.query(
      `DROP TYPE "message_channel_schedules_channel_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "message_channel_schedules_family_enum"`,
    );

    await queryRunner.dropColumn('clients', 'sms_reminders_enabled');
    await queryRunner.dropColumn('clients', 'email_reminders_enabled');

    // phone_number can only become NOT NULL again without its email rows.
    await queryRunner.query(
      `DELETE FROM "message_log_items" WHERE "message_log_id" IN (SELECT "id" FROM "message_logs" WHERE "channel" <> 'whatsapp')`,
    );
    await queryRunner.query(
      `UPDATE "message_logs" SET "retry_of_message_log_id" = NULL WHERE "retry_of_message_log_id" IN (SELECT "id" FROM "message_logs" WHERE "channel" <> 'whatsapp')`,
    );
    await queryRunner.query(
      `DELETE FROM "message_logs" WHERE "channel" <> 'whatsapp'`,
    );
    await queryRunner.dropIndex(
      'message_logs',
      'IDX_message_logs_provider_message_id',
    );
    await queryRunner.query(
      `ALTER TABLE "message_logs" DROP CONSTRAINT "CHK_message_logs_recipient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_logs" ALTER COLUMN "phone_number" SET NOT NULL`,
    );
    await queryRunner.dropColumn('message_logs', 'provider_message_id');
    await queryRunner.dropColumn('message_logs', 'email');
    await queryRunner.dropColumn('message_logs', 'channel');
    await queryRunner.query(`DROP TYPE "message_logs_channel_enum"`);
  }
}
