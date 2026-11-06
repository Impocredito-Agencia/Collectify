import { Pager } from '@/components/ui/Pager';
import { RowActionButton } from '@/components/ui/RowActionButton';
import { Td, Th } from '@/components/ui/Table';
import { RefinanceChainNote } from '@/features/loans/RefinanceChainNote';
import { useDeletedLoans } from '@/features/loans/useLoanDeletion';
import { formatDateTime } from '@/lib/format';
import { useSessionState } from '@/lib/useSessionState';

import type { ReactNode } from 'react';

const CENTERED = { textAlign: 'center' } as const;

// Phase 35 — Préstamos' "Eliminados" tab. Open to every user (a cobrador
// must be able to answer a client who asks about one); read-only, every
// row only opens the deleted pagaré's detail. Newest deletion first, as
// the api returns it.
export function DeletedLoansPanel() {
  const [search, setSearch] = useSessionState('loans.deleted.search', '');
  const [page, setPage] = useSessionState('loans.deleted.page', 1);

  const { data, isLoading, isError } = useDeletedLoans({
    search: search || undefined,
    page,
  });
  const loans = data?.items ?? [];
  const meta = data?.meta;
  const rowNumberOffset = ((meta?.page ?? 1) - 1) * (meta?.limit ?? 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex h-10 items-center gap-3">
        <div className="flex h-[38px] w-[220px] items-center gap-2 rounded bg-input px-3">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar cliente o pagaré…"
            className="w-full bg-transparent text-small text-white placeholder-mid focus:outline-none"
          />
        </div>
        <p className="text-label text-muted">
          Pagarés eliminados: solo se pueden consultar, no modificar.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg bg-surface">
        <table className="w-full min-w-[880px] table-fixed">
          <thead className="bg-input">
            <tr className="divide-x divide-border">
              <Th className="w-10 whitespace-nowrap">#</Th>
              <Th className="w-24" style={CENTERED}>
                Pagaré
              </Th>
              <Th style={CENTERED}>Cliente</Th>
              <Th style={CENTERED}>Eliminado</Th>
              <Th style={CENTERED}>Eliminado por</Th>
              <Th style={CENTERED}>Motivo</Th>
              <Th className="w-28" style={CENTERED}>
                Tenía pagos
              </Th>
              <Th className="w-24" style={CENTERED}>
                Acciones
              </Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <EmptyRow>Cargando…</EmptyRow>}
            {isError && (
              <EmptyRow tone="error">
                No se pudo cargar la lista de pagarés eliminados.
              </EmptyRow>
            )}
            {!isLoading && !isError && loans.length === 0 && (
              <EmptyRow>No hay pagarés eliminados.</EmptyRow>
            )}
            {loans.map((loan, index) => (
              <tr
                key={loan.id}
                className="divide-x divide-border border-t border-border"
              >
                <Td muted>{rowNumberOffset + index + 1}</Td>
                <Td className="text-center">
                  {loan.promissoryNoteNumber}
                  <RefinanceChainNote refinancedLoans={loan.refinancedLoans} />
                </Td>
                <Td>{loan.clientFullName}</Td>
                <Td muted className="text-center">
                  {formatDateTime(loan.deletedAt)}
                </Td>
                <Td muted className="text-center">
                  {loan.deletedByFullName ?? '—'}
                </Td>
                <Td
                  muted
                  className="truncate"
                  title={loan.deletionReason ?? undefined}
                >
                  {loan.deletionReason ?? 'Sin motivo registrado'}
                </Td>
                <Td muted className="text-center">
                  {loan.hadPayments ? 'Sí' : 'No'}
                </Td>
                <Td className="text-center">
                  <RowActionButton to={`/prestamos/eliminados/${loan.id}`}>
                    Ver
                  </RowActionButton>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta && meta.total > 0 && (
        <div className="flex h-8 items-center justify-between">
          <p className="text-label text-muted">
            Mostrando {loans.length} de {meta.total} pagarés eliminados
          </p>
          <Pager
            page={page}
            totalPages={meta.totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}

function EmptyRow({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <tr>
      <td
        colSpan={8}
        className={`p-6 text-center text-small ${tone === 'error' ? 'text-danger' : 'text-muted'}`}
      >
        {children}
      </td>
    </tr>
  );
}
