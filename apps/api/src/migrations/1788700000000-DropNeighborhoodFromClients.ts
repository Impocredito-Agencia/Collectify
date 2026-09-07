import { MigrationInterface, QueryRunner } from 'typeorm';

// Client request (2026-09-06): "barrio" was never actually used anywhere
// once entered (no report, filter, or message referenced it), and adds a
// field to fill in for no benefit — dropped rather than kept as an unused
// historical column, same call made for loans.usury_justification/
// usury_ceiling_exceeded_at_creation (see
// 1785500000000-DropUsuryWarningFieldsFromLoans.ts). Added originally in
// 1785200000000-AddExtendedProfileFieldsToClients.ts (Phase 21) — that
// migration is left untouched, per this project's "migrations never
// edited after being merged" rule; this is a new migration instead.
export class DropNeighborhoodFromClients1788700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "neighborhood"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clients" ADD COLUMN "neighborhood" varchar`,
    );
  }
}
