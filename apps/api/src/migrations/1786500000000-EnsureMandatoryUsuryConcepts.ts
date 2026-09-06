import { MigrationInterface } from 'typeorm';

// Retired, 2026-09-05 (production incident) — this migration's own
// timestamp (1786500000000) sorts AFTER
// RemoveIsUsuryRateConceptFromInterestConceptTypes1786400000000, which was
// merged later chronologically but landed with a lower timestamp. Any
// environment with both migrations still pending runs the drop first, so
// by the time this one's up() executes, `is_usury_rate_concept` no longer
// exists — `column "is_usury_rate_concept" does not exist`, migration
// fails, `railway.toml`'s `migration:run && start:prod` never reaches
// start:prod. Confirmed via the failing production log that this crashed
// and rolled back before ever being recorded as applied, in every
// environment that has both migrations pending — so turning this into a
// no-op changes nothing that already happened anywhere.
//
// The mandatory-flagged-catalog-concept mechanism this migration was
// patching no longer exists at all — the usury rate redesign
// (RemoveIsUsuryRateConceptFromInterestConceptTypes) replaced it with
// direct fields on the loan itself (see
// LoansService.buildInterestConceptAssignment,
// CreateLoanDto.corrienteInterestRate/moratoryInterestRate). Not deleted
// outright so the migration history stays a complete, ordered record of
// what actually happened.
export class EnsureMandatoryUsuryConcepts1786500000000 implements MigrationInterface {
  public async up(): Promise<void> {}

  public async down(): Promise<void> {}
}
