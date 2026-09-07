import { RowActionButton } from '@/components/ui/RowActionButton';
import { Td } from '@/components/ui/Table';
import {
  estadoBadge,
  moraBadgeClasses,
} from '@/features/loans/loanStatusDisplay';
import { LoanStatus } from '@/features/loans/loansApi';
import { formatCurrency } from '@/lib/format';

import type { LoanSummary } from '@/features/loans/loansApi';

interface LoanRowProps {
  loan: LoanSummary;
  rowNumber: number;
}

export function LoanRow({ loan, rowNumber }: LoanRowProps) {
  const estado = estadoBadge(loan);
  // Paid/refinanced loans have no pending installments left, so the "Pago"
  // shortcut (which opens the payment dialog for the oldest pending
  // installment) would silently do nothing. Shown disabled instead of
  // hidden so the row layout stays consistent. See DESIGN_TOKENS.md
  // "Known design/backend gaps".
  const hasPendingInstallments =
    loan.status !== LoanStatus.Paid && loan.status !== LoanStatus.Refinanced;

  return (
    <tr className="divide-x divide-border border-t border-border">
      <Td muted>{rowNumber}</Td>
      <Td className="whitespace-nowrap text-center">
        {loan.promissoryNoteNumber}
      </Td>
      <Td>{loan.clientFullName}</Td>
      <Td className="text-center">{formatCurrency(loan.outstandingBalance)}</Td>
      <Td className="text-center">
        {loan.installmentsPaid}/{loan.totalInstallments}
      </Td>
      <Td className="text-center">
        <span
          className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(loan.overdueDays)}`}
        >
          {loan.overdueDays} días
        </span>
      </Td>
      <Td className="text-center">
        <span
          className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${estado.classes}`}
        >
          {estado.label}
        </span>
      </Td>
      <Td className="text-center">
        <div className="flex justify-center gap-2">
          <RowActionButton to={`/prestamos/${loan.id}`}>Ver</RowActionButton>
          {hasPendingInstallments ? (
            <RowActionButton to={`/prestamos/${loan.id}?pago=1`}>
              Pago
            </RowActionButton>
          ) : (
            <span
              className="cursor-not-allowed rounded-[3px] border border-border bg-input px-1.75 py-1 text-meta text-mid"
              title="No hay cuotas pendientes por pagar"
            >
              Pago
            </span>
          )}
        </div>
      </Td>
    </tr>
  );
}
