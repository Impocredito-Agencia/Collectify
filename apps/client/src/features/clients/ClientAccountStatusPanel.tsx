import { Link } from 'react-router-dom';

import { StatusBadge } from '@/components/ui/StatusBadge';
import { useClientAccountStatus } from '@/features/clients/useClients';
import { moraBadgeClasses } from '@/features/loans/loanStatusDisplay';
import { formatCurrency } from '@/lib/format';

import type { ReactNode } from 'react';

interface ClientAccountStatusPanelProps {
  clientId: string;
}

interface AccountStatusRow {
  key: string;
  loanId: string;
  promissoryNoteNumber: string;
  installmentNumber: number;
  amount: number;
  status: ReactNode;
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
//
// Redesign, 2026-09-15 (human report — the original one-row-per-cuota
// table wasted most of its width on short values and repeated the same
// pagaré number on every row of a multi-cuota loan). Grouped by pagaré
// instead — one compact card per loan with something pending, each
// listing just its own cuotas — laid out two-up so several short cards
// share a row instead of one table stretched edge to edge.
export function ClientAccountStatusPanel({
  clientId,
}: ClientAccountStatusPanelProps) {
  const { data } = useClientAccountStatus(clientId);

  if (!data) {
    return null;
  }

  const rows: AccountStatusRow[] = [
    ...data.overdue.map((installment) => ({
      key: installment.id,
      loanId: installment.loanId,
      promissoryNoteNumber: installment.promissoryNoteNumber,
      installmentNumber: installment.installmentNumber,
      amount: installment.totalDue,
      // Confirmed with the human, 2026-09-15 — the same 0/1-30/31-60/60+
      // mora-severity coloring the "Días mora" column already uses
      // elsewhere (LoanRow.tsx, LoanDetailPage.tsx), not StatusBadge's
      // flat "danger" — a cuota 3 days overdue and one 137 days overdue
      // shouldn't look the same. "Vence en" badges below stay neutral:
      // their window tops out at ~5 days, too short for these buckets to
      // ever differentiate anything.
      status: (
        <span
          className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(installment.overdueDays)}`}
        >
          Vencida hace {installment.overdueDays}{' '}
          {installment.overdueDays === 1 ? 'día' : 'días'}
        </span>
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

  // Map preserves insertion order, and `rows` lists every overdue cuota
  // (oldest due date first) before any upcoming one — so the first pagaré
  // encountered is whichever has the single oldest overdue cuota, giving
  // the most urgent loan the first card without a separate sort pass.
  const groups = new Map<
    string,
    { loanId: string; promissoryNoteNumber: string; rows: AccountStatusRow[] }
  >();
  for (const row of rows) {
    const existing = groups.get(row.loanId);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(row.loanId, {
        loanId: row.loanId,
        promissoryNoteNumber: row.promissoryNoteNumber,
        rows: [row],
      });
    }
  }

  const totalOverdue = data.overdue.reduce(
    (sum, installment) => sum + installment.totalDue,
    0,
  );

  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <p className="text-[15px] font-medium text-white">Estado de cuenta</p>
          <p className="text-small text-muted">
            Cuotas vencidas y próximas a vencer, en todos sus pagarés.
          </p>
        </div>
        {/* Human request, 2026-09-15 — only shown when something's actually
            overdue; "Total vencido: $0" would read oddly for a client
            whose only pending cuotas are upcoming, not late. Label to the
            left of a large number (not stacked above it) so the figure
            that actually matters fills the row's height instead of
            sharing it with a second line of text. */}
        {totalOverdue > 0 && (
          <div className="flex items-center gap-3">
            <p className="max-w-[110px] text-balance text-right text-meta text-muted">
              Total vencido en todos sus pagarés
            </p>
            <p className="text-[28px] font-semibold leading-none text-danger">
              {formatCurrency(totalOverdue)}
            </p>
          </div>
        )}
      </div>
      {groups.size === 0 ? (
        <p className="px-6 py-4 text-small text-muted">
          Al día — no tiene cuotas vencidas ni próximas a vencer.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-4">
          {Array.from(groups.values()).map((group) => (
            <div
              key={group.loanId}
              className="rounded border border-border bg-input/40 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <Link
                  to={`/prestamos/${group.loanId}`}
                  className="text-small font-medium text-white hover:underline"
                >
                  Pagaré {group.promissoryNoteNumber}
                </Link>
                <span className="text-small text-muted">
                  {formatCurrency(
                    group.rows.reduce((sum, row) => sum + row.amount, 0),
                  )}
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
                {group.rows.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-small text-muted">
                      Cuota {row.installmentNumber} —{' '}
                      {formatCurrency(row.amount)}
                    </span>
                    {row.status}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
