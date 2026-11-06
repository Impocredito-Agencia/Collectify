import { Link, useParams } from 'react-router-dom';

import { DeletedLoanInstallmentsTable } from '@/features/loans/DeletedLoanInstallmentsTable';
import { DeletedLoanPaymentsTable } from '@/features/loans/DeletedLoanPaymentsTable';
import { LoanOriginationTermsView } from '@/features/loans/LoanOriginationTerms';
import { InstallmentFrequency, LoanStatus } from '@/features/loans/loansApi';
import { useDeletedLoan } from '@/features/loans/useLoanDeletion';
import { formatCurrency, formatDateOnly, formatDateTime } from '@/lib/format';

import type { DeletedLoanDetail } from '@/features/loans/loanDeletionApi';
import type { ReactNode } from 'react';

const STATUS_AT_DELETION: Record<LoanStatus, string> = {
  [LoanStatus.Active]: 'Activo',
  [LoanStatus.Paid]: 'Pagado',
  [LoanStatus.Refinanced]: 'Refinanciado',
};

const FREQUENCY_LABELS: Record<InstallmentFrequency, string> = {
  [InstallmentFrequency.Monthly]: 'Mensual',
  [InstallmentFrequency.Biweekly]: 'Quincenal',
};

// Phase 35 — read-only view of a deleted pagaré, open to every user, so
// nobody needs database access to answer "what happened to this pagaré".
// Deliberately has NO action of any kind: nothing can be paid, edited or
// restored from here. See docs/phasesClient/PHASE_35_LOAN_DELETION.md.
export function DeletedLoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: loan, isLoading, isError } = useDeletedLoan(id ?? '');

  if (isLoading) {
    return <p className="text-small text-muted">Cargando…</p>;
  }
  if (isError || !loan) {
    return (
      <p className="text-small text-danger" role="alert">
        No se encontró este pagaré eliminado.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1.5 text-label">
        <Link to="/prestamos" className="text-muted hover:text-white">
          Préstamos
        </Link>
        <span className="text-mid">/</span>
        <span className="text-muted">Eliminados</span>
        <span className="text-mid">/</span>
        <span className="font-medium text-white">
          {loan.promissoryNoteNumber} — {loan.clientFullName}
        </span>
      </div>

      <div
        className="rounded border border-danger bg-danger-bg px-5 py-4"
        role="status"
      >
        <p className="text-control font-semibold text-danger">
          Pagaré eliminado el {formatDateTime(loan.deletedAt)}
          {loan.deletedByFullName ? ` por ${loan.deletedByFullName}` : ''}
        </p>
        <p className="mt-1 text-small text-danger">
          Motivo: {loan.deletionReason ?? 'sin motivo registrado'}
        </p>
        <p className="mt-2 text-label text-muted">
          Solo consulta: este pagaré no se puede pagar, modificar ni restaurar.
          {loan.hadPayments &&
            ' Tenía pagos registrados, que quedaron anulados, y su número no puede volver a usarse.'}
        </p>
      </div>

      <div className="rounded border border-border bg-surface px-6 py-5">
        <h1 className="text-page-title font-semibold text-white">
          Préstamo {loan.promissoryNoteNumber}
        </h1>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-3">
          <Detail label="Cliente">
            <Link
              to={`/clientes/${loan.clientId}`}
              className="text-white hover:underline"
            >
              {loan.clientFullName}
            </Link>
            {loan.clientDocumentNumber && (
              <span className="text-muted">
                {' '}
                · CC {loan.clientDocumentNumber}
              </span>
            )}
          </Detail>
          <Detail label="Capital inicial">
            {formatCurrency(loan.principalAmount)}
          </Detail>
          <Detail label="Estado al eliminarlo">
            {STATUS_AT_DELETION[loan.status]}
          </Detail>
          <Detail label="Desembolso">{formatDateOnly(loan.disbursedAt)}</Detail>
          <Detail label="Cuotas">
            {loan.totalInstallments} ·{' '}
            {FREQUENCY_LABELS[loan.installmentFrequency]}
          </Detail>
          <Detail label="Descripción">{loan.description ?? '—'}</Detail>
        </dl>
        {loan.deletedTogether.length > 0 && <RefinanceChain loan={loan} />}
      </div>

      <LoanOriginationTermsView terms={loan.originationTerms} />

      <DeletedLoanInstallmentsTable
        installments={loan.installments}
        hasFrozenFigures={loan.hasFrozenFigures}
      />

      <DeletedLoanPaymentsTable payments={loan.payments} />
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-label text-muted">{label}</dt>
      <dd className="mt-0.5 text-small text-strong">{children}</dd>
    </div>
  );
}

// The whole refinance chain in order, oldest first — refinanced chains
// usually share one number after a renumber, so each link is told apart by
// its position ("Original", "Refinanciación 1"…), not by its number.
function RefinanceChain({ loan }: { loan: DeletedLoanDetail }) {
  const earlierIds = new Set(loan.refinancedLoans.map((other) => other.id));
  const chain = [
    ...[...loan.refinancedLoans].reverse(),
    { id: loan.id, promissoryNoteNumber: loan.promissoryNoteNumber },
    ...loan.deletedTogether.filter((other) => !earlierIds.has(other.id)),
  ];

  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-small text-muted">
        Cadena de refinanciamiento — se eliminó completa:
      </p>
      <ol className="flex flex-wrap items-center gap-2 text-small">
        {chain.map((link, index) => {
          const label = `${index === 0 ? 'Original' : `Refinanciación ${index}`} · ${link.promissoryNoteNumber}`;
          return (
            <li key={link.id} className="flex items-center gap-2">
              {index > 0 && <span className="text-muted">→</span>}
              {link.id === loan.id ? (
                <span className="rounded-[3px] border border-danger bg-danger-bg px-2 py-[3px] font-medium text-danger">
                  {label} (este)
                </span>
              ) : (
                <Link
                  to={`/prestamos/eliminados/${link.id}`}
                  className="rounded-[3px] border border-border px-2 py-[3px] text-white hover:bg-input"
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
