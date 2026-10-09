import { useState } from 'react';

import { DatePicker } from '@/components/ui/DatePicker';
import { useClientBreakdown } from '@/features/whatsappInboundMessages/useWhatsappInboundMessages';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency, formatDateOnly } from '@/lib/format';

import type { ClientBreakdownInstallment } from '@/features/whatsappInboundMessages/clientBreakdownApi';

interface ClientBreakdownAsOfProps {
  clientId: string;
}

// Human report, 2026-10-09 — "los clientes mandan comprobantes viejos …
// quieren ver ese día cómo estaban desglosadas las cuotas con valores
// exactos". Mora grows daily, so the figures everywhere else in this panel
// (today's) no longer match what the client owed on the day they actually
// made the transfer. Pick that day and this lists each cuota still pending
// today with the value it had then. Informational only — nothing here
// registers or changes a payment.
export function ClientBreakdownAsOf({ clientId }: ClientBreakdownAsOfProps) {
  const [date, setDate] = useState('');
  const {
    data: breakdown,
    isLoading,
    error,
  } = useClientBreakdown(clientId, date);

  // A pagaré can carry a year of future cuotas — only the ones already
  // overdue or due that day are what a comprobante would be paying, so the
  // rest stay folded away unless asked for.
  const [showNotYetDue, setShowNotYetDue] = useState(false);

  const allInstallments = breakdown?.installments ?? [];
  const notYetDueCount = allInstallments.filter(isNotYetDue).length;
  const groups = groupByPromissoryNote(
    showNotYetDue
      ? allInstallments
      : allInstallments.filter((installment) => !isNotYetDue(installment)),
  );

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border p-3">
      <div>
        <p className="text-small font-medium text-white">
          Desglose a una fecha
        </p>
        <p className="text-meta text-muted">
          Para comprobantes antiguos: cuánto debía cada cuota el día del pago.
        </p>
      </div>
      <DatePicker
        value={date}
        onChange={setDate}
        ariaLabel="Fecha del comprobante"
        placeholder="Fecha del comprobante"
        className="h-[34px] w-full rounded bg-input px-3 text-small text-muted"
      />

      {date && isLoading && <p className="text-meta text-muted">Cargando…</p>}
      {date && error && (
        <p className="text-meta text-danger" role="alert">
          {error instanceof ApiError
            ? error.message
            : 'No se pudo cargar el desglose.'}
        </p>
      )}

      {breakdown && breakdown.installments.length === 0 && (
        <p className="text-meta text-muted">
          No tenía cuotas pendientes el {formatDateOnly(breakdown.date)}.
        </p>
      )}

      {breakdown && breakdown.installments.length > 0 && (
        <>
          {groups.map(([promissoryNoteNumber, installments]) => (
            <div key={promissoryNoteNumber} className="flex flex-col gap-1">
              <p className="text-meta font-medium text-white">
                Pagaré {promissoryNoteNumber}
              </p>
              {installments.map((installment) => (
                <BreakdownRow
                  key={installment.installmentId}
                  installment={installment}
                />
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="text-meta text-muted">
              Ninguna cuota estaba vencida ese día.
            </p>
          )}
          {notYetDueCount > 0 && (
            <button
              type="button"
              onClick={() => setShowNotYetDue((shown) => !shown)}
              className="w-fit text-meta text-subtle underline hover:text-white"
            >
              {showNotYetDue
                ? 'Ocultar cuotas que aún no vencían'
                : `Ver ${notYetDueCount} cuota${notYetDueCount === 1 ? '' : 's'} que aún no vencía${notYetDueCount === 1 ? '' : 'n'}`}
            </button>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-meta">
            <span className="text-muted">
              Total exigible el {formatDateOnly(breakdown.date)}
            </span>
            <span className="font-medium text-white">
              {formatCurrency(breakdown.totalPayableOnDate)}
            </span>
          </div>
          <p className="text-meta text-subtle">
            Solo cuotas que siguen pendientes hoy, con la mora y los abonos de
            ese día.
          </p>
        </>
      )}
    </div>
  );
}

function BreakdownRow({
  installment,
}: {
  installment: ClientBreakdownInstallment;
}) {
  const isOverdue = installment.overdueDays > 0;
  const statusLabel = isOverdue
    ? `${installment.overdueDays}d vencida`
    : installment.daysUntilDue === 0
      ? 'vencía ese día'
      : `vencía en ${installment.daysUntilDue}d`;
  const hasDetail = installment.interest > 0 || installment.paidByDate > 0;

  return (
    <div className="flex flex-col py-1 text-meta">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted">
          Cuota {installment.installmentNumber} ·{' '}
          {formatDateOnly(installment.dueDate)}
        </span>
        <span className={isOverdue ? 'text-danger' : 'text-subtle'}>
          {formatCurrency(installment.totalDue)} · {statusLabel}
        </span>
      </div>
      {hasDetail && (
        <span className="text-subtle">
          Cuota {formatCurrency(installment.amount)}
          {installment.interest > 0 &&
            ` + recargos ${formatCurrency(installment.interest)}`}
          {installment.paidByDate > 0 &&
            ` − abonado ${formatCurrency(installment.paidByDate)}`}
        </span>
      )}
    </div>
  );
}

function isNotYetDue(installment: ClientBreakdownInstallment): boolean {
  return installment.overdueDays === 0 && installment.daysUntilDue > 0;
}

// First-appearance order — the API already sorts by due date.
function groupByPromissoryNote(
  installments: ClientBreakdownInstallment[],
): [string, ClientBreakdownInstallment[]][] {
  const groups = new Map<string, ClientBreakdownInstallment[]>();
  for (const installment of installments) {
    const group = groups.get(installment.promissoryNoteNumber);
    if (group) {
      group.push(installment);
    } else {
      groups.set(installment.promissoryNoteNumber, [installment]);
    }
  }
  return Array.from(groups.entries());
}
