import { MigrationInterface, QueryRunner } from 'typeorm';

// Feature request, 2026-09-03 (human) — until now the admin hand-computed
// the monthly effective rate from the Superintendencia's published annual
// rate and typed only the result into `rate_percentage`. That's error-prone
// (compounding math done by hand every month) and `rate_percentage`'s old
// precision (5,2 — two decimals) couldn't even hold the real monthly figure
// without truncating it (e.g. 2.1605% would round to 2.16%). Confirmed with
// the human: no real usury rate has ever been entered in production yet
// (the app isn't in live use), so there's no historical data to reconcile —
// this migration only adds the new column and widens the existing one.
//
// `annual_rate_percentage` is the raw published annual rate (e.g. 29.24 for
// "29,24%" — https://www.superfinanciera.gov.co, interés bancario
// corriente), entered by the admin from now on. `rate_percentage` keeps its
// existing meaning and every existing downstream consumer (LoansService
// pricing percentage concepts per installment) — it's still the monthly
// effective rate actually applied — just computed automatically by
// UsuryRateService.setRate instead of typed by hand, and stored with enough
// precision to keep it (7,4 — up to 999.9999%, four decimal places instead
// of two). See UsuryRateService's convertAnnualToMonthlyRate for the
// compounding formula.
export class AddAnnualRateToUsuryRates1786400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "usury_rates" ADD COLUMN "annual_rate_percentage" decimal(6,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "usury_rates" ALTER COLUMN "rate_percentage" TYPE decimal(7,4)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "usury_rates" ALTER COLUMN "rate_percentage" TYPE decimal(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "usury_rates" DROP COLUMN "annual_rate_percentage"`,
    );
  }
}
