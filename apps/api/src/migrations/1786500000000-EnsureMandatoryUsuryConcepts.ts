import { MigrationInterface, QueryRunner } from 'typeorm';

// Bug fix, 2026-09-03 (human report, third screenshot of the same
// warning) — SeedDefaultUsuryRateConcepts1786300000000 was written to
// insert a mandatory "Tasa de usura" concept for BOTH categories, but its
// corriente row never actually showed up in this environment: LoanForm
// keeps showing "No hay un cargo obligatorio... para cargos corrientes"
// while the moratorio one works fine. Most likely explanation, without
// direct DB access to confirm — TypeORM tracks which migrations have run
// by name in its own migrations table; if an earlier, narrower version of
// that file (moratorio-only) had already run and been recorded before it
// was widened to also seed corriente, the corriente half of its up() body
// was simply never executed, no matter what the file contains today.
//
// Rather than guess further, this is a fresh migration with its own
// timestamp, and it's idempotent: it only acts on a category that doesn't
// already have an active, flagged concept, so it's safe to run regardless
// of what did or didn't happen before, and safe to run again later too.
export class EnsureMandatoryUsuryConcepts1786500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.ensureCategory(queryRunner, 'corriente');
    await this.ensureCategory(queryRunner, 'moratorio');
  }

  private async ensureCategory(
    queryRunner: QueryRunner,
    category: 'corriente' | 'moratorio',
  ): Promise<void> {
    const flagged = (await queryRunner.query(
      `SELECT id FROM "interest_concept_types" WHERE category = $1 AND is_usury_rate_concept = true AND is_active = true LIMIT 1`,
      [category],
    )) as Array<{ id: string }>;
    if (flagged.length > 0) {
      return;
    }

    // A row named 'Tasa de usura' for this category might already exist
    // but unflagged or inactive (leftover from a partial earlier attempt)
    // — reuse it instead of inserting a duplicate the admin would have to
    // clean up by hand in "Tipos de cargo".
    const existingByName = (await queryRunner.query(
      `SELECT id FROM "interest_concept_types" WHERE category = $1 AND name = 'Tasa de usura' AND deleted_at IS NULL LIMIT 1`,
      [category],
    )) as Array<{ id: string }>;

    if (existingByName.length > 0) {
      await queryRunner.query(
        `UPDATE "interest_concept_types" SET is_usury_rate_concept = true, is_active = true WHERE id = $1`,
        [existingByName[0].id],
      );
      return;
    }

    await queryRunner.query(
      `INSERT INTO "interest_concept_types"
        (id, name, default_calculation_type, category, is_active, is_usury_rate_concept)
      VALUES
        (gen_random_uuid(), 'Tasa de usura', 'percentage', $1, true, true)`,
      [category],
    );
  }

  // No-op — this migration only fills a gap the previous seed migration
  // was supposed to cover in the first place; reverting it would just
  // reintroduce the bug. SeedDefaultUsuryRateConcepts.down() already
  // handles removing these rows if that one is ever rolled back.
  public async down(): Promise<void> {}
}
