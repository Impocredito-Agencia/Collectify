import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-23 — per-number "desactivar mensajes" on a client's
// profile. See Client.mutedPhoneNumbers. Defaults to an empty array, so
// every existing client keeps receiving everything exactly as before.
export class AddMutedPhoneNumbersToClients1791100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clients" ADD COLUMN "muted_phone_numbers" text[] NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clients" DROP COLUMN "muted_phone_numbers"`,
    );
  }
}
