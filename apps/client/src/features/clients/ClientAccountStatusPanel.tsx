import { Link } from 'react-router-dom';

import { StatusBadge } from '@/components/ui/StatusBadge';
import { Td, Th } from '@/components/ui/Table';
import { useClientAccountStatus } from '@/features/clients/useClients';
import { formatCurrency } from '@/lib/format';

interface ClientAccountStatusPanelProps {
  clientId: string;
}

// Human request, 2026-09-15 — when a client walks into the office, the
// front desk needs to say "your pagaré #X owes cuota N for $Y" right away,
// without opening the messages module to read their last WhatsApp
// reminder (which goes stale the moment a same-day payment is
// registered). Reuses the exact same overdue/upcoming queries the
// reminders themselves are built from (ClientsService.getAccountStatus),
// so this can never disagree with what the client was already told.
//
// Always rendered, including the empty state — unlike ClientCreditBanner
// (which hides entirely when there's nothing to show), a front-desk
// lookup needs a clear "nothing pending" answer just as much as a list of
// what's owed; empty space here would read as "still loading", not "all
// good".
export function ClientAccountStatusPanel({
  clientId,
}: ClientAccountStatusPanelProps) {
  const { data } = useClientAccountStatus(clientId);

  if (!data) {
    return null;
  }

  const rows = [
    ...data.overdue.map((installment) => ({
      key: installment.id,
      loanId: installment.loanId,
      promissoryNoteNumber: installment.promissoryNoteNumber,
      installmentNumber: installment.installmentNumber,
      amount: installment.totalDue,
      status: (
        <StatusBadge tone="danger">
          Vencida hace {installment.overdueDays}{' '}
          {installment.overdueDays === 1 ? 'día' : 'días'}
        </StatusBadge>
      ),
    })),
    ...data.upcoming.map((installment) => ({
      key: installment.id,
      loanId: installment.loanId,
      promissoryNoteNumber: installment.promissoryNoteNumber,
      installmentNumber: installment.installmentNumber,
      amount: installment.amount,
      status: (
        <StatusBadge tone="neutral">
          Vence en {installment.daysUntilDue}{' '}
          {installment.daysUntilDue === 1 ? 'día' : 'días'}
        </StatusBadge>
      ),
    })),
  ];

  return (
    <div className="rounded border border-border bg-surface">
      <div className="border-b border-border px-6 py-4">
        <p className="text-[15px] font-medium text-white">Estado de cuenta</p>
        <p className="text-small text-muted">
          Cuotas vencidas y próximas a vencer, en todos sus pagarés.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-4 text-small text-muted">
          Al día — no tiene cuotas vencidas ni próximas a vencer.
        </p>
      ) : (
        <table className="w-full table-fixed">
          <thead className="bg-input">
            <tr className="divide-x divide-border">
              <Th style={{ textAlign: 'center' }}>Pagaré</Th>
              <Th className="w-24" style={{ textAlign: 'center' }}>
                Cuota
              </Th>
              <Th style={{ textAlign: 'center' }}>Valor</Th>
              <Th className="w-48" style={{ textAlign: 'center' }}>
                Estado
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="divide-x divide-border">
                <Td className="text-center">
                  <Link
                    to={`/prestamos/${row.loanId}`}
                    className="text-white hover:underline"
                  >
                    {row.promissoryNoteNumber}
                  </Link>
                </Td>
                <Td className="text-center">{row.installmentNumber}</Td>
                <Td className="text-center">{formatCurrency(row.amount)}</Td>
                <Td className="text-center">{row.status}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
