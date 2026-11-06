import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 35 — irreversible loan deletion with an audit trail (see
// docs/phases/PHASE_35_LOAN_DELETION.md). A deleted pagaré stays in `loans`
// (deleted_at, as before) and now also records who deleted it, why, and
// its cuotas' figures frozen at that moment, so the panel can show it
// read-only without anyone opening the database. All nullable: every live
// loan, and every loan deleted before this phase, simply has none.
export class AddDeletionAuditToLoans1791900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loans" ADD COLUMN "deleted_by_user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" ADD CONSTRAINT "FK_loans_deleted_by_user_id" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" ADD COLUMN "deletion_reason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" ADD COLUMN "deletion_snapshot" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN "deletion_snapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN "deletion_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP CONSTRAINT "FK_loans_deleted_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN "deleted_by_user_id"`,
    );
  }
}
