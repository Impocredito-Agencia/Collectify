import { MigrationInterface, QueryRunner } from 'typeorm';

// Client decision (2026-09-09): interest_rate was the pre-Phase-23 single
// moratory rate — superseded once a loan gets its own moratory concepts
// (LoanInstallmentConcept), which every loan created through
// LoansService.create()/refinance() always ends up with, unconditionally
// (resolveConceptsWithInterest always builds a system-generated
// "Intereses moratorios" concept, at the current usury ceiling if no rate
// is requested). enrichInstallment()'s fallback branch that used to read
// this column for a loan with zero moratory concepts was therefore
// structurally unreachable through any live code path — verified before
// dropping this, not assumed. Its only other consumer, the loan-only
// Excel import (LoanImportService, apps/api/src/loanImport), was removed
// outright in the same change: it was never wired to any button in
// apps/client and the client confirmed it was never going to be used, so
// there was nothing left to migrate onto a moratory-concept requirement
// instead. See docs/DATABASE.md's "Removed, 2026-09-09" note for the full
// story.
export class DropInterestRateFromLoans1789200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loans" DROP COLUMN "interest_rate"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loans" ADD COLUMN "interest_rate" numeric(5,2)`,
    );
  }
}
