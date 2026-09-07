import { MigrationInterface, QueryRunner } from 'typeorm';

// Feature request, 2026-09-06 (human) — same underlying problem as
// AddAnnualRateToUsuryRates1786400000000's rate_percentage widening: both
// interest_concept_types.default_value (the catalog's suggested starting
// value) and loan_installment_concepts.value (what actually gets snapshotted
// onto a loan's installments at generation time — see LoanInstallmentConcept
// entity) were still decimal(12,2), so a percentage cargo could never be
// entered or stored more precisely than two decimal places, even though the
// admin panel's number input never enforced that limit itself (it just got
// silently rounded on save). Widened to (12,4) here, the same target
// precision already used for ratePercentage.
//
// Scoped to PERCENTAGE concepts only (confirmed with the human): a
// fixed_amount concept is a currency amount, which has no legitimate use for
// more than 2 decimal places — Colombian pesos don't have subunits in
// practice. Both columns are shared by both calculation types (there's no
// separate column per type), so the extra precision is physically available
// to a fixed_amount row too; CreateInterestConceptTypeDto and
// LoanConceptAssignmentDto are what actually enforce the split — at most 4
// decimals for a percentage value, at most 2 for a fixed_amount one — not
// this migration. See those DTOs' own comments.
//
// Existing 2-decimal values are unaffected: decimal(12,2) -> decimal(12,4) is
// a widening, not a truncation, so no data is lost or needs backfilling.
export class WidenConceptValuePrecision1788900000000 implements MigrationInterface {
  name = 'WidenConceptValuePrecision1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "interest_concept_types" ALTER COLUMN "default_value" TYPE decimal(12,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_installment_concepts" ALTER COLUMN "value" TYPE decimal(12,4)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: this will lose precision on any row that, by the time of
    // rollback, actually holds more than 2 decimal places — an expected and
    // accepted risk of rolling back a completed business-rule change, same
    // precedent as ScopePromissoryNoteNumberUniquenessToActiveLoans's down().
    await queryRunner.query(
      `ALTER TABLE "loan_installment_concepts" ALTER COLUMN "value" TYPE decimal(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "interest_concept_types" ALTER COLUMN "default_value" TYPE decimal(12,2)`,
    );
  }
}
