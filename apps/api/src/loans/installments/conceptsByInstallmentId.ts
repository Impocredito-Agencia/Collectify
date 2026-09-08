import { In, Repository } from 'typeorm';

import { LoanInstallmentConcept } from '../entities/loanInstallmentConcept.entity';

// Bug fix, 2026-09-08 — shared by every caller that needs an installment's
// real LoanInstallmentConcept rows (corriente + moratorio) to pass into
// enrichInstallment.ts. Extracted here instead of duplicated per caller
// (loans.service.ts and installments.service.ts each already had their own
// private, byte-identical copy of this exact query before this fix) because
// the same gap — a caller passing `concepts=[]` instead of fetching the
// real rows — is what let enrichInstallment.ts silently fall back to the
// legacy single-rate formula with `interestRate` frozen at 0 for every loan
// created since the Phase 23 redesign (#254 — see LoanForm.tsx/
// RefinanceLoanForm.tsx's own `interestRate: 0` comment), reporting ZERO
// moratory interest everywhere this was missed: WhatsApp reminders and
// self-service menu, the Dashboard's "cuotas vencidas" widget, and a
// client's creditUsed/creditAvailable (cupo). See docs/DATABASE.md's note
// of this date for the full list of call sites this closes the gap in.
// loans.service.ts/installments.service.ts keep their own existing private
// copies unchanged (out of scope for this fix — not the source of the bug,
// already correct) rather than being migrated onto this shared version, to
// keep this fix's diff limited to the actually-broken call sites.
//
// One query for N installments (not N queries), same convention as
// sumPaymentsByInstallmentId (paymentTotals.ts).
export async function findConceptsByInstallmentId(
  loanInstallmentConceptsRepository: Repository<LoanInstallmentConcept>,
  installmentIds: string[],
): Promise<Map<string, LoanInstallmentConcept[]>> {
  const map = new Map<string, LoanInstallmentConcept[]>();
  if (installmentIds.length === 0) {
    return map;
  }

  const concepts = await loanInstallmentConceptsRepository.find({
    where: { installmentId: In(installmentIds) },
  });
  for (const concept of concepts) {
    const existing = map.get(concept.installmentId) ?? [];
    existing.push(concept);
    map.set(concept.installmentId, existing);
  }
  return map;
}
