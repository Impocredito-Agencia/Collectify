import { MigrationInterface, QueryRunner } from 'typeorm';

// Human confirmed, 2026-09-16: two clients must never share a phone number.
// phone_number has had a plain (non-unique) index since CreateClientsTable —
// this only tightens it to unique, same shape as document_number's own
// index. See ClientsService.assertPhoneNumberIsUnique for the app-level
// check that gives a friendly error before ever reaching this constraint;
// this index is the last-resort guarantee against a concurrent-request race.
//
// Reuses the existing index name (dropped and recreated as unique) rather
// than adding a second index on the same column.
export class AddUniqueConstraintToClientsPhoneNumber1790800000000 implements MigrationInterface {
  name = 'AddUniqueConstraintToClientsPhoneNumber1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_clients_phone_number"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_clients_phone_number" ON "clients" ("phone_number")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_clients_phone_number"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_clients_phone_number" ON "clients" ("phone_number")
    `);
  }
}
