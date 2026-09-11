import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-18 — every loan that currently exists is a
// historical/backfilled one, never a genuinely new credit event, so none
// of them should be eligible for NewLoanReminderService's "nuevo pagaré"
// sweep (which only picks up isNewLoan: true rows). Some rows are
// incorrectly true: LoanForm.tsx's "es un préstamo nuevo" checkbox was
// removed for a brief window (between the two reverts documented in
// docs/DATABASE.md's "Reverted, 2026-09-06 — new-loan/refinance messages
// back to synchronous send" and Loan.isNewLoan's own comment, restored
// 2026-09-09), during which the form sent isNewLoan: true
// unconditionally — see CreateLoanDto.isNewLoan's corrected comment. Any
// loan entered through the form in that window is stuck with the wrong
// value regardless of the fact that the current code already defaults to
// false. Sets every existing loan to false, unconditionally — not just
// the ones already true — since the human confirmed all of them are old.
// A genuinely new loan created after this runs is unaffected: it still
// goes through LoansService.create(), which sets isNewLoan from the
// checkbox exactly as before.
export class SetIsNewLoanFalseForExistingLoans1789900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "loans" SET "is_new_loan" = false`);
  }

  // Deliberately irreversible: down() is a no-op — there's no way to know
  // which of these rows (if any) were genuinely true before this ran.
  public async down(): Promise<void> {}
}
