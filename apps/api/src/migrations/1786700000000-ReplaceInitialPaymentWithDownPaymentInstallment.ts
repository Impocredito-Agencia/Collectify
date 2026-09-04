import { MigrationInterface, QueryRunner } from 'typeorm';

// Replaces Phase 13's "cuota inicial" model again, this time for real:
// client confirmed (2026-09-03) that a down payment negotiated at loan
// creation IS one of the credit's real, collectible installments — it's
// just interest-free and due on whatever date the client and the business
// agreed to, independent of the periodic schedule that governs installment
// 2 onward. The previous model (loans.initial_payment, a purely
// informational decimal with no due date, no collection, no mora) was
// simply wrong for this case; it's dropped outright, no data preserved
// (confirmed with the human — no loans currently rely on it).
//
// installments.is_down_payment flags the single installment (always
// installmentNumber 1 when present) created this way, so the app can:
// skip generating corriente-interest concepts for it, still generate
// moratorio concepts (mora applies if the client misses this date too,
// per human confirmation), and render an "Inicial" badge on it. This is
// NOT a repeat of Phase 13's original is_initial mistake — that flag
// existed when a down payment was explicitly NOT a real installment; here
// it is one, so a per-installment flag is the correct model.
export class ReplaceInitialPaymentWithDownPaymentInstallment1786700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "installments" ADD COLUMN "is_down_payment" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "loans" DROP COLUMN "initial_payment"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loans" ADD COLUMN "initial_payment" decimal(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "installments" DROP COLUMN "is_down_payment"`,
    );
  }
}
