import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-09 — a worker registered a payment for the full
// balance when the client had actually only paid part of it, closing the
// cuota when it should have stayed pending. There was no way to correct or
// undo a payment once registered — Payment already had a `deleted_at`
// column (like every other table in this project) but nothing ever wrote
// to it, since no void/delete endpoint existed.
//
// Reuses that existing soft-delete column as "voided" rather than adding a
// separate voided_at timestamp — every query in the codebase that sums or
// lists a client's payments already excludes soft-deleted rows by default
// (TypeORM's own behavior), so voiding a payment this way automatically
// stops it from counting anywhere (the payment ceiling, cupo, WhatsApp,
// the Dashboard, "saldo pendiente"/"saldo a favor") with no other code
// change needed — only the loan detail's own payment history explicitly
// opts back in with `withDeleted: true`, so a voided payment stays visible
// there, marked as such, instead of silently disappearing.
//
// This column only carries the mandatory reason — see
// InstallmentsService.voidPayment().
export class AddVoidReasonToPayments1789100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "void_reason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "void_reason"`);
  }
}
