import { MigrationInterface, QueryRunner } from 'typeorm';

// Client request, 2026-09-08 — "edad y sexo o género" on the client
// profile. Age is deliberately NOT a stored column: it's computed on the
// frontend from the existing dateOfBirth (Phase 21) instead of duplicating
// a value that would silently go stale. Gender is the only actual new
// column here. Nullable and not required anywhere — confirmed with the
// human this is a fillable field, not a mandatory one, for either the
// interactive ClientForm or the Excel import. Same pattern as
// documentType (AddExtendedProfileFieldsToClients1785200000000).
export class AddGenderToClients1789000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "clients_gender_enum" AS ENUM('masculino', 'femenino', 'otro')`,
    );
    await queryRunner.query(
      `ALTER TABLE "clients" ADD COLUMN "gender" "clients_gender_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "gender"`);
    await queryRunner.query(`DROP TYPE "clients_gender_enum"`);
  }
}
