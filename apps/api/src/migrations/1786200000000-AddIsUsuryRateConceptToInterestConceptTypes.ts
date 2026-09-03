import { MigrationInterface, QueryRunner } from 'typeorm';

// Bug fix, 2026-09-03 (human report) — see the isUsuryRateConcept doc
// comment in apps/api/src/interestConceptTypes/entities/interestConceptType.entity.ts.
export class AddIsUsuryRateConceptToInterestConceptTypes1786200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "interest_concept_types" ADD COLUMN "is_usury_rate_concept" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "interest_concept_types" DROP COLUMN "is_usury_rate_concept"`,
    );
  }
}
