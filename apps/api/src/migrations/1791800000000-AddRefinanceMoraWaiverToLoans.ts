import { MigrationInterface, QueryRunner } from 'typeorm';

// Human request, 2026-11-05 — some clients who refinance get part of their
// accrued mora forgiven. Recorded on the NEW loan the refinance creates. See
// Loan.refinanceMoraWaivedAmount. Defaults to 0 / NULL, so every existing
// loan reads exactly as before.
export class AddRefinanceMoraWaiverToLoans1791800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loans" ADD COLUMN "refinance_mora_waived_amount" numeric(12,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" ADD COLUMN "refinance_mora_waiver_reason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN "refinance_mora_waiver_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN "refinance_mora_waived_amount"`,
    );
  }
}
