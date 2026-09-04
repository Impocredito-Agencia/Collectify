import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-03 — "cobrar solo en la primera cuota" had no real
// use case for this client; what they actually needed was a fixed amount
// charged in full on every installment (e.g. a recurring monthly fee), not
// divided and not one-off. Renaming the enum value instead of adding a third
// one, since the client asked to replace it outright. Same "widen via
// drop/recreate" pattern as AddHandedOffToHumanConversationMenuValue —
// Postgres won't let an enum value be renamed directly pre-PG10-safe, and
// this repo targets the lowest common denominator. See
// FixedAmountDistribution's own comment in interestConceptType.entity.ts.
export class RenameFirstInstallmentOnlyToRepeatedEachInstallment1786600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "interest_concept_types" ALTER COLUMN "fixed_amount_distribution" TYPE varchar USING "fixed_amount_distribution"::text`,
    );
    await queryRunner.query(
      `UPDATE "interest_concept_types" SET "fixed_amount_distribution" = 'repeated_each_installment' WHERE "fixed_amount_distribution" = 'first_installment_only'`,
    );
    await queryRunner.query(
      `DROP TYPE "interest_concept_types_fixed_amount_distribution_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "interest_concept_types_fixed_amount_distribution_enum" AS ENUM('split_across_installments', 'repeated_each_installment')`,
    );
    await queryRunner.query(
      `ALTER TABLE "interest_concept_types" ALTER COLUMN "fixed_amount_distribution" TYPE "interest_concept_types_fixed_amount_distribution_enum" USING "fixed_amount_distribution"::"interest_concept_types_fixed_amount_distribution_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "interest_concept_types" ALTER COLUMN "fixed_amount_distribution" TYPE varchar USING "fixed_amount_distribution"::text`,
    );
    await queryRunner.query(
      `UPDATE "interest_concept_types" SET "fixed_amount_distribution" = 'first_installment_only' WHERE "fixed_amount_distribution" = 'repeated_each_installment'`,
    );
    await queryRunner.query(
      `DROP TYPE "interest_concept_types_fixed_amount_distribution_enum"`,
    );
    await queryRunner.query(
      `CREATE TYPE "interest_concept_types_fixed_amount_distribution_enum" AS ENUM('split_across_installments', 'first_installment_only')`,
    );
    await queryRunner.query(
      `ALTER TABLE "interest_concept_types" ALTER COLUMN "fixed_amount_distribution" TYPE "interest_concept_types_fixed_amount_distribution_enum" USING "fixed_amount_distribution"::"interest_concept_types_fixed_amount_distribution_enum"`,
    );
  }
}
