import { MigrationInterface, QueryRunner } from 'typeorm';

// Added 2026-09-06 (human request) — the "new loan" WhatsApp message stops
// being sent synchronously at creation and becomes a scheduled cron sweep
// (see WhatsappCronService's new NewLoan family, NewLoanReminderService.
// runPendingLoanNotifications). That sweep needs a way to tell a
// genuinely new credit event apart from a historical/backfilled loan
// being entered into the platform after the fact (bulk import, or an old
// loan book still being typed in by hand) — those must never trigger the
// message, no matter when they're created.
//
// DEFAULT false is deliberate, not just a placeholder: it means every
// loan already in the database — including today's bulk-imported ones —
// is safely excluded from the sweep from the moment this column exists,
// with no separate backfill/cleanup step required. Going forward, the
// admin explicitly opts a loan into "this is new, notify the client" via
// a checkbox on LoanForm/RefinanceLoanForm; leaving it unchecked (the
// default) is what "esto es viejo/histórico" means in that UI.
export class AddIsNewLoanToLoans1788658565460 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loans" ADD COLUMN "is_new_loan" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loans" DROP COLUMN "is_new_loan"`);
  }
}
