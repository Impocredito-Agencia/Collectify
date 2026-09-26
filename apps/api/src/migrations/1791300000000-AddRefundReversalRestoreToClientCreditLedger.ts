import { MigrationInterface, QueryRunner } from 'typeorm';

// Human request, 2026-09-26 — saldo a favor gains three more movements (see
// ClientCreditLedgerEntryType): `refunded` (cash handed back to the client),
// `reversed` (the credit a voided payment had generated is taken back) and
// `restored` (the credit a voided credit-funded payment had spent is given
// back), plus a free-text `note` for the refund reason. Same "widen via
// drop/recreate" enum pattern as AddFreeTextTicketTriggerKindValue, since
// Postgres won't let a newly-added enum value be used in the transaction it
// was added in.
const OLD_VALUES = ['created', 'applied'];
const NEW_VALUES = [...OLD_VALUES, 'refunded', 'reversed', 'restored'];
const ENUM_NAME = 'client_credit_ledger_entries_type_enum';

export class AddRefundReversalRestoreToClientCreditLedger1791300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_credit_ledger_entries" ALTER COLUMN "type" TYPE varchar USING "type"::text`,
    );
    await queryRunner.query(`DROP TYPE "${ENUM_NAME}"`);
    await queryRunner.query(
      `CREATE TYPE "${ENUM_NAME}" AS ENUM (${NEW_VALUES.map((v) => `'${v}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_credit_ledger_entries" ALTER COLUMN "type" TYPE "${ENUM_NAME}" USING "type"::"${ENUM_NAME}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_credit_ledger_entries" ADD COLUMN "note" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_credit_ledger_entries" DROP COLUMN "note"`,
    );
    // Any row already using a new value would fail this cast — acceptable
    // for a down migration, same precedent as this repo's other
    // enum-widening migrations.
    await queryRunner.query(
      `ALTER TABLE "client_credit_ledger_entries" ALTER COLUMN "type" TYPE varchar USING "type"::text`,
    );
    await queryRunner.query(`DROP TYPE "${ENUM_NAME}"`);
    await queryRunner.query(
      `CREATE TYPE "${ENUM_NAME}" AS ENUM (${OLD_VALUES.map((v) => `'${v}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_credit_ledger_entries" ALTER COLUMN "type" TYPE "${ENUM_NAME}" USING "type"::"${ENUM_NAME}"`,
    );
  }
}
