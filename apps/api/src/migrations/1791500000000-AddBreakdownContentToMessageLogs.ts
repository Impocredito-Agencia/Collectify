import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

// Human report, 2026-10-09 — the cuota-by-cuota desglose behind a reminder
// that only reports a count and a summed total. See reminderBreakdown.ts.
// Nullable with no backfill: a row sent before this column existed keeps
// null, since its per-cuota totals at send time were never stored.
export class AddBreakdownContentToMessageLogs1791500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'message_logs',
      new TableColumn({
        name: 'breakdown_content',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('message_logs', 'breakdown_content');
  }
}
