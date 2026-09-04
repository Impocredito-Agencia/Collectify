import { MigrationInterface, QueryRunner } from 'typeorm';

// Redesign, 2026-09-03 (human report — "esa solución de que al crear un
// cargo... se le marque la casilla que ese sería el cargo de intereses
// corrientes... a mí me parece mala", followed by the human confirming a
// system-generated field is the better design). Undoes
// AddIsUsuryRateConceptToInterestConceptTypes/SeedDefaultUsuryRateConcepts:
// the loan's own corriente/moratorio interest is no longer a flagged
// catalog entry — see LoansService.buildInterestConceptAssignment() and
// CreateLoanDto.corrienteInterestRate/moratoryInterestRate.
//
// The two "Tasa de usura" rows those earlier migrations seeded are
// deactivated rather than deleted — they're very likely already referenced
// by real loans' LoanInstallmentConcept rows (interestConceptTypeId,
// onDelete: SET NULL either way, so deleting would be safe for historical
// data too, but deactivating is simpler and reversible, and keeps the
// catalog's own audit trail intact). Deactivating hides them from the
// "Cargos adicionales" picker on new loans, so an admin can't accidentally
// pick "Tasa de usura" as a confusing extra fee on top of the new built-in
// interest field.
export class RemoveIsUsuryRateConceptFromInterestConceptTypes1786400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "interest_concept_types" SET "is_active" = false WHERE "name" = 'Tasa de usura' AND "is_usury_rate_concept" = true`,
    );
    await queryRunner.query(
      `ALTER TABLE "interest_concept_types" DROP COLUMN "is_usury_rate_concept"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "interest_concept_types" ADD COLUMN "is_usury_rate_concept" boolean NOT NULL DEFAULT false`,
    );
    // Reactivating the seeded rows and re-flagging them is intentionally
    // left to a human decision if this migration is ever rolled back — a
    // blind re-flag here could silently reintroduce ambiguity if the admin
    // created other "Tasa de usura"-named concepts in the meantime.
  }
}
