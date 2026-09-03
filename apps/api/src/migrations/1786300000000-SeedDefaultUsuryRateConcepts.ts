import { MigrationInterface, QueryRunner } from 'typeorm';

// Bug fix, 2026-09-03 (human follow-up) — the mandatory usury-rate concept
// mechanism (see AddIsUsuryRateConceptToInterestConceptTypes) required the
// admin to manually create and flag a concept before they could create
// ANY loan at all. That defeats the point: the usury rate was already
// being auto-applied to any percentage concept (Phase 24), so this should
// just work automatically, out of the box, with no setup step. Seeds the
// two canonical rows — one per category — flagged isUsuryRateConcept:
// true from the start. The admin can still repoint the flag to a
// different concept later via the existing toggle
// (InterestConceptTypeForm.tsx) if they ever want to; this migration
// defensively unsets any concept a human may have already flagged in
// this same session/environment first, so exactly one per category ends
// up true regardless of what ran before it.
export class SeedDefaultUsuryRateConcepts1786300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "interest_concept_types" SET "is_usury_rate_concept" = false WHERE "category" = 'corriente'`,
    );
    await queryRunner.query(
      `UPDATE "interest_concept_types" SET "is_usury_rate_concept" = false WHERE "category" = 'moratorio'`,
    );
    await queryRunner.query(`
      INSERT INTO "interest_concept_types"
        ("id", "name", "default_calculation_type", "category", "is_active", "is_usury_rate_concept")
      VALUES
        (gen_random_uuid(), 'Tasa de usura', 'percentage', 'corriente', true, true),
        (gen_random_uuid(), 'Tasa de usura', 'percentage', 'moratorio', true, true)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "interest_concept_types" WHERE "name" = 'Tasa de usura' AND "is_usury_rate_concept" = true`,
    );
  }
}
