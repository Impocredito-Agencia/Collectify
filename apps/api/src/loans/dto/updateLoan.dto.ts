import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

// Only description and the co-debtor fields (Phase 21, updated to a client
// link in Phase 26) are editable post-creation. Both are plain metadata
// with no cascading effects.
//
// Client feedback, 2026-09-04 (final call, after trying a broader edit
// surface first): interestRate and moratoryConcepts briefly lived here too
// — see git history / docs/DATABASE.md's "Resolved" note on `interest_rate`
// for the full back-and-forth — but the client decided the same day that
// even a "safe" correction (a moratory concept's value, or the legacy
// interestRate fallback) wasn't worth keeping once they saw it in
// practice: there was little real use for it, and it muddies a much
// simpler rule — a préstamo's numbers are fixed the moment it's created;
// anything wrong there needs Refinanciar (which regenerates the schedule
// AND notifies the client), never a silent PATCH. principalAmount, the
// cuota schedule, interestRate, and every concept (corriente or
// moratorio) are therefore all immutable here on purpose. Only
// description survived as an editable field — a pure typo/wording fix
// has no bearing on what the client owes and doesn't need Refinanciar's
// full weight (new pagaré, cancelled installments, new WhatsApp message).
export class UpdateLoanDto {
  @ApiPropertyOptional({
    example: 'Compra de Apple MacBook Air M5, 512GB',
  })
  @IsOptional()
  @IsString()
  description?: string;

  // --- Optional co-debtor (codeudor), Phase 26 — at most one per loan, an
  // existing Client picked by id. Must not be the same client as this
  // loan's own client — enforced in LoansService. See
  // docs/phases/PHASE_26_CODEBTOR_CLIENT.md. ---

  @ApiPropertyOptional({
    description: "An existing client's id, picked as this loan's co-debtor.",
  })
  @IsOptional()
  @IsUUID()
  coDebtorClientId?: string;

  @ApiPropertyOptional({ example: 'Hermano del deudor' })
  @IsOptional()
  @IsString()
  coDebtorRelationship?: string;
}
