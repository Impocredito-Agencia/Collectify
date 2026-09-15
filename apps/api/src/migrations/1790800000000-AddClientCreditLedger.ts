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
export class AddClientCreditLedger1790800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "funded_by_credit" boolean NOT NULL DEFAULT false`,
    );

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
    await queryRunner.dropTable('client_credit_ledger_entries');
    await queryRunner.query(
      `DROP TYPE "client_credit_ledger_entries_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "funded_by_credit"`,
    );
  }
}
