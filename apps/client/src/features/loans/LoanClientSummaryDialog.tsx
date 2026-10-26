import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import { Td, Th } from '@/components/ui/Table';
import { buildClientSummary } from '@/features/loans/clientSummary';
import { moraBadgeClasses } from '@/features/loans/loanStatusDisplay';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { Installment } from '@/features/installments/installmentsApi';

// Th hardcodes text-left, and a competing text-center class isn't
// guaranteed to win the cascade — an inline style always does (see ThProps'
// own `style` comment).
const CENTERED = { textAlign: 'center' } as const;

interface LoanClientSummaryDialogProps {
  promissoryNoteNumber: string;
  clientFullName: string;
  installments: Installment[];
  onClose: () => void;
}

// Client request, 2026-10-23 — "no quiere enviarle una captura donde se
// desglose tanto cada cuota". A read-only estado de cuenta sized for a
// screenshot the admin sends to the debtor over WhatsApp: every cuota of
// the plan (paid ones marked "Pagada" since 2026-10-26), mora surcharges collapsed into one column, totals at the bottom.
// The full per-concept breakdown stays on LoanDetailPage's own table.
export function LoanClientSummaryDialog({
  promissoryNoteNumber,
  clientFullName,
  installments,
  onClose,
}: LoanClientSummaryDialogProps) {
  useEscapeKey(onClose);

  const summary = buildClientSummary(installments);
  // The day the mora figures were calculated for — calculated-on-read by
  // the api, so "today" in Colombia, whatever the viewer's own clock says.
  const cutoffDate = new Date().toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
  });

  return (
    <Modal maxWidth="max-w-[960px]" scroll>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-meta font-semibold tracking-wide text-accent">
            IMPROCRÉDITO
          </p>
          <h2 className="mt-1 text-[16px] font-medium text-white">
            Estado de cuenta · Pagaré {promissoryNoteNumber}
          </h2>
          <p className="mt-1 text-small text-muted">
            {clientFullName} · Corte al {cutoffDate}
          </p>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      {/* No "saldo pendiente" card (client feedback, 2026-10-23): summing the
          plan's pending cuotas isn't what settling the debt today costs, so
          showing it to the debtor was misleading. */}
      <div className="mt-5 grid grid-cols-1 gap-3 text-center sm:grid-cols-2">
        <StatCard
          label="Cuotas pagadas"
          value={`${summary.paidCount} de ${summary.totalCount}`}
        />
        <StatCard
          label="Total vencido hoy"
          value={formatCurrency(summary.overdueTotal)}
          tone={summary.overdueTotal > 0 ? 'accent' : 'default'}
        />
      </div>

      {summary.rows.length === 0 ? (
        <p className="mt-5 text-small text-muted">
          Este pagaré no tiene cuotas.
        </p>
      ) : (
        // Symmetric on purpose (client feedback, 2026-10-23 — "no se mira
        // simétrico"): table-fixed with no column widths splits the row
        // evenly across every column, and every cell is centered, so the
        // screenshot reads as an even grid rather than a dense data table.
        <div className="mt-4 overflow-x-auto rounded border border-border bg-surface">
          <table className="w-full min-w-[560px] table-fixed border-collapse">
            <thead className="bg-accent/10">
              <tr className="divide-x divide-border">
                <Th compact style={CENTERED}>
                  Cuota
                </Th>
                <Th compact style={CENTERED}>
                  Vence
                </Th>
                <Th compact style={CENTERED}>
                  Días de mora
                </Th>
                <Th compact style={CENTERED}>
                  Valor cuota
                </Th>
                <Th compact style={CENTERED}>
                  Valor mora
                </Th>
                {summary.hasPartialPayments && (
                  <Th compact style={CENTERED}>
                    Abonado
                  </Th>
                )}
                <Th compact style={CENTERED}>
                  Total a pagar
                </Th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr
                  key={row.installmentId}
                  className="divide-x divide-border border-t border-border"
                >
                  <Td compact className="text-center">
                    {row.installmentNumber}
                    {row.isDownPayment && (
                      <span className="ml-1 text-meta text-muted">
                        (inicial)
                      </span>
                    )}
                  </Td>
                  <Td compact className="text-center">
                    {formatDateOnly(row.dueDate)}
                  </Td>
                  <Td compact className="text-center">
                    {row.isPaid ? (
                      <span
                        className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(0)}`}
                      >
                        Pagada
                      </span>
                    ) : row.overdueDays > 0 ? (
                      <span
                        className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(row.overdueDays)}`}
                      >
                        {row.overdueDays} días
                      </span>
                    ) : (
                      <span className="text-mid">Al día</span>
                    )}
                  </Td>
                  <Td compact className="text-center">
                    {formatCurrency(row.amount)}
                  </Td>
                  <Td compact className="text-center" muted={!row.surcharges}>
                    {row.surcharges > 0 ? formatCurrency(row.surcharges) : '—'}
                  </Td>
                  {summary.hasPartialPayments && (
                    <Td compact className="text-center" muted={!row.paidSoFar}>
                      {row.paidSoFar > 0
                        ? `− ${formatCurrency(row.paidSoFar)}`
                        : '—'}
                    </Td>
                  )}
                  <Td compact className="text-center" muted={row.isPaid}>
                    {row.isPaid ? '—' : formatCurrency(row.totalDue)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </Modal>
  );
}
