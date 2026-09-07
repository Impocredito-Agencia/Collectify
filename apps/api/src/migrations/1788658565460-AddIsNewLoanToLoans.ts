import { MigrationInterface, QueryRunner } from 'typeorm';

// Added 2026-09-06 (human request) — originally written for a scheduled
// cron-sweep design (WhatsappCronService's short-lived NewLoan family,
// NewLoanReminderService.runPendingLoanNotifications) that was reverted
// the same day (confirmed with the human) back to a synchronous send
// from LoansService.create()/refinance() — see that revert's comments in
// loans.service.ts and newLoanReminder.service.ts. The column itself,
// and the reason it exists, are unaffected by that revert: it still
// tells a genuinely new credit event apart from a historical/backfilled
// loan being entered into the platform after the fact (bulk import, or
// an old loan book still being typed in by hand) — those must never
// trigger the message.
//
// DEFAULT false is deliberate, not just a placeholder: it means every
// loan already in the database — including bulk-imported ones — is
// safely excluded from the moment this column exists, with no separate
// backfill/cleanup step required. There is no checkbox anywhere anymore
// either (RefinanceLoanForm's was removed first, always true there;
// LoanForm's was removed the same day) — LoanForm now always sends
// `true`, so in practice only bulk Excel import (which never sets this
// field) and loans that predate this column still resolve to false.
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
