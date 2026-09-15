import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

// Human report, 2026-09-14 — see ClientCreditLedgerEntry's own comment. A
// payment exceeding what an installment owes is now accepted instead of
// rejected outright; the excess is tracked here as a client-level credit,
// applicable (by explicit operator action, never automatically) to any
// pending installment of any of the client's loans.
//
// Bug fix, 2026-09-15 (human report — `npm run migration:run` failed with
// "column funded_by_credit already exists"): briefly renamed to
// AddClientCreditLedger1790800000000 to resolve a filename collision with
// AddMetaMediaIdToWhatsappInboundMessages1790700000000 (both landed on the
// same millisecond by coincidence, from two branches merged around the
// same time) — but this migration had, by then, already run against real
// databases under ITS ORIGINAL name. TypeORM matches "already executed"
// by migration NAME (the class name, stored in the `migrations` table),
// not by file timestamp, so the rename made every environment that had
// already run this migration try to run it again and fail on the
// already-existing column/table. Reverted back to this original name —
// the timestamp collision is genuinely just a filename convention
// violation, not a functional bug (TypeORM never confuses the two
// differently-NAMED migrations), so it's left as-is rather than "fixed"
// again in a way that would break migration history a second time.
//
// Made defensive (existence checks before each ALTER/CREATE) in the same
// fix — Railway's deploy runs migrations automatically, so by the time
// this rename went out, production had almost certainly already run this
// under the OLD (now temporarily-wrong) name, recording it in the
// `migrations` table as such. Reverting the name alone would make
// production see this as a brand-new pending migration and try to run it
// again, failing on the now-existing column/table exactly like it did
// locally — but there was no way to safely confirm production's exact
// migrations-table state to fix it surgically instead. These guards make
// `up()` a safe no-op in every possible state (never run anywhere; run
// under this same name already; or run under the temporary wrong name
// already) without needing to know which one applies, or touching the
// `migrations` table by hand.
export class AddClientCreditLedger1790700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasFundedByCreditColumn = await queryRunner.hasColumn(
      'payments',
      'funded_by_credit',
    );
    if (!hasFundedByCreditColumn) {
      await queryRunner.query(
        `ALTER TABLE "payments" ADD COLUMN "funded_by_credit" boolean NOT NULL DEFAULT false`,
      );
    }

    const hasLedgerTable = await queryRunner.hasTable(
      'client_credit_ledger_entries',
    );
    if (hasLedgerTable) {
      return;
    }

    await queryRunner.query(
      `CREATE TYPE "client_credit_ledger_entries_type_enum" AS ENUM ('created', 'applied')`,
    );

    await queryRunner.createTable(
      new Table({
        name: 'client_credit_ledger_entries',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'client_id',
            type: 'uuid',
          },
          {
            name: 'type',
            type: 'client_credit_ledger_entries_type_enum',
          },
          {
            name: 'amount',
            type: 'decimal',
            precision: 12,
            scale: 2,
          },
          {
            name: 'source_payment_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'resulting_payment_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'client_credit_ledger_entries',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );
    await queryRunner.createForeignKey(
      'client_credit_ledger_entries',
      new TableForeignKey({
        columnNames: ['source_payment_id'],
        referencedTableName: 'payments',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );
    await queryRunner.createForeignKey(
      'client_credit_ledger_entries',
      new TableForeignKey({
        columnNames: ['resulting_payment_id'],
        referencedTableName: 'payments',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createIndex(
      'client_credit_ledger_entries',
      new TableIndex({
        name: 'IDX_client_credit_ledger_entries_client_id',
        columnNames: ['client_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasLedgerTable = await queryRunner.hasTable(
      'client_credit_ledger_entries',
    );
    if (hasLedgerTable) {
      await queryRunner.dropTable('client_credit_ledger_entries');
      await queryRunner.query(
        `DROP TYPE "client_credit_ledger_entries_type_enum"`,
      );
    }

    const hasFundedByCreditColumn = await queryRunner.hasColumn(
      'payments',
      'funded_by_credit',
    );
    if (hasFundedByCreditColumn) {
      await queryRunner.query(
        `ALTER TABLE "payments" DROP COLUMN "funded_by_credit"`,
      );
    }
  }
}
