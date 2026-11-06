import type { DeletedLoanSummary } from '@/features/loans/loanDeletionApi';

// Phase 35 — a deleted refinance chain is listed as ONE row (the pagaré
// that was active when it was deleted); this line under its number says
// the earlier loans are part of it, so the chain doesn't read as several
// unrelated debts. Renders nothing for a loan that wasn't refinanced.
export function RefinanceChainNote({
  refinancedLoans,
}: Pick<DeletedLoanSummary, 'refinancedLoans'>) {
  if (refinancedLoans.length === 0) {
    return null;
  }
  const times = refinancedLoans.length;
  return (
    <span
      className="block text-meta text-muted"
      title={`Incluye los pagarés anteriores de la cadena: ${refinancedLoans
        .map((loan) => loan.promissoryNoteNumber)
        .join(', ')}`}
    >
      Refinanciado {times} {times === 1 ? 'vez' : 'veces'}
    </span>
  );
}
