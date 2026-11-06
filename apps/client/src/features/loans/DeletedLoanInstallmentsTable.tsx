import { Td, Th } from '@/components/ui/Table';
import { moraBadgeClasses } from '@/features/loans/loanStatusDisplay';
import { formatCurrency, formatDateOnly } from '@/lib/format';

import type { DeletedInstallment } from '@/features/loans/loanDeletionApi';

const CENTERED = { textAlign: 'center' } as const;

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  paid: 'Pagada',
  cancelled: 'Cancelada',
};

interface DeletedLoanInstallmentsTableProps {
  installments: DeletedInstallment[];
  hasFrozenFigures: boolean;
}

// Phase 35 — the deleted pagaré's cuotas exactly as they were at the moment
// of deletion: cuota value AND the mora it had then (frozen, never
// recalculated — see apps/api/src/loans/deletion/loanDeletionSnapshot.ts),
// like the live loan's own table shows both side by side.
export function DeletedLoanInstallmentsTable({
  installments,
  hasFrozenFigures,
}: DeletedLoanInstallmentsTableProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-section-label font-normal tracking-normal text-subtle">
        Cuotas al momento de eliminarlo
      </span>
      {!hasFrozenFigures && (
        <p className="text-small text-muted">
          Este pagaré se eliminó antes de que se guardaran sus cifras, así que
          sus cuotas se muestran sin mora.
        </p>
      )}
      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full min-w-[720px] table-fixed border-collapse">
          <thead className="bg-input">
            <tr className="divide-x divide-border">
              <Th className="w-14" style={CENTERED}>
                N°
              </Th>
              <Th style={CENTERED}>Vence</Th>
              <Th style={CENTERED}>Cuota</Th>
              <Th style={CENTERED}>Días de mora</Th>
              <Th style={CENTERED}>Valor mora</Th>
              <Th style={CENTERED}>Pagado</Th>
              <Th style={CENTERED}>Total</Th>
              <Th style={CENTERED}>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {installments.map((installment) => (
              <tr
                key={installment.installmentNumber}
                className="divide-x divide-border border-t border-border"
              >
                <Td className="text-center">
                  {installment.installmentNumber}
                  {installment.isDownPayment && (
                    <span className="ml-1 text-meta text-muted">(inicial)</span>
                  )}
                </Td>
                <Td className="text-center">
                  {formatDateOnly(installment.dueDate)}
                </Td>
                <Td className="text-center">
                  {formatCurrency(installment.amount)}
                </Td>
                <Td className="text-center">
                  {installment.overdueDays > 0 ? (
                    <span
                      className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(installment.overdueDays)}`}
                    >
                      {installment.overdueDays} días
                    </span>
                  ) : (
                    <span className="text-mid">—</span>
                  )}
                </Td>
                <Td className="text-center" muted={!installment.interest}>
                  {installment.interest > 0
                    ? formatCurrency(installment.interest)
                    : '—'}
                </Td>
                <Td className="text-center" muted={!installment.totalPaid}>
                  {installment.totalPaid > 0
                    ? formatCurrency(installment.totalPaid)
                    : '—'}
                </Td>
                <Td className="text-center" muted={!installment.totalDue}>
                  {installment.totalDue > 0
                    ? formatCurrency(installment.totalDue)
                    : '—'}
                </Td>
                <Td muted className="text-center">
                  {STATUS_LABELS[installment.status] ?? installment.status}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
