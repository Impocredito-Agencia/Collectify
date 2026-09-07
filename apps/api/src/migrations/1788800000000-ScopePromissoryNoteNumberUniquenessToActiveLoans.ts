import { MigrationInterface, QueryRunner } from 'typeorm';

// Business change, 2026-09-06 (confirmed with the human) — refinancing a
// loan now keeps the SAME promissory note number instead of being assigned
// a new one (see docs/DATABASE.md "Refinancing"): refinancing #0800 replaces
// it with a new loan that is ALSO #0800. Over a pagaré's lifetime this means
// the same #NNNN legitimately repeats across any number of historical
// (Refinanced) rows plus, at any one time, at most one Active row — the old
// column-level "unique across every row, forever" constraint from
// CreateLoansTable1783656163787 is no longer correct and must be scoped down
// to "unique among currently-active loans" instead.
//
// The original constraint was created via `isUnique: true` on the column
// definition (not a hand-named TableUnique), so Postgres auto-generated its
// name — looked up dynamically via queryRunner.getTable() rather than
// hard-coded, since the generated name isn't something this migration can
// predict. `IDX_loans_promissory_note_number` (the separate, already
// non-unique lookup index from the same migration) is untouched.
export class ScopePromissoryNoteNumberUniquenessToActiveLoans1788800000000 implements MigrationInterface {
  name = 'ScopePromissoryNoteNumberUniquenessToActiveLoans1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('loans');
    const legacyUnique = table?.uniques.find((unique) =>
      unique.columnNames.includes('promissory_note_number'),
    );
    if (legacyUnique) {
      await queryRunner.dropUniqueConstraint('loans', legacyUnique);
    }

    // Partial unique index: only rows that are currently the "live" holder
    // of a pagaré (status = 'active', not soft-deleted) must be unique on
    // promissory_note_number. Historical rows (paid/refinanced) are exempt
    // by design — that's exactly how the same number is allowed to recur
    // across a refinancing chain. A genuinely NEW loan is still permanently
    // blocked from reusing any historical number, but that's an
    // application-layer rule (LoansService.assertPromissoryNoteNumberIsUnique,
    // run for every new loan except a refinance's own inherited number —
    // see its and skipPromissoryNoteNumberUniquenessCheck's comments), not
    // something this partial index alone could express. This index's own
    // job is narrower: it's the last-resort DB-level guarantee against a
    // concurrent double-refinance race producing two ACTIVE loans sharing
    // one number.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_loans_promissory_note_number_active"
      ON "loans" ("promissory_note_number")
      WHERE "status" = 'active' AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "UQ_loans_promissory_note_number_active"`,
    );
    // Restores the original unconditional constraint. Note: this will fail
    // to apply if, by the time of rollback, any refinancing chain has
    // actually produced duplicate promissory_note_number values across
    // rows — an expected and accepted risk of rolling back a completed
    // business-rule change, not something this migration works around.
    await queryRunner.query(`
      ALTER TABLE "loans"
      ADD CONSTRAINT "UQ_loans_promissory_note_number" UNIQUE ("promissory_note_number")
    `);
  }
}
