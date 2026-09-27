import { MigrationInterface, QueryRunner } from 'typeorm';

// Human request, 2026-09-25 — collectors sometimes discount or forgive the
// accrued mora when a client settles a cuota. See Payment.moraWaivedAmount.
// Defaults to 0 / NULL, so every existing payment reads exactly as before.
export class AddMoraWaiverToPayments1791200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "mora_waived_amount" numeric(12,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "mora_waiver_reason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "mora_waiver_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "mora_waived_amount"`,
    );
  }
}
