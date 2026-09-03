import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Legend } from '@/components/ui/Legend';
import { Select } from '@/components/ui/Select';
import { Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/useAuth';
import { LoanForm } from '@/features/loans/LoanForm';
import { LoanRow } from '@/features/loans/LoanRow';
import { LoanStatus } from '@/features/loans/loansApi';
import { useCreateLoan, useLoans } from '@/features/loans/useLoans';
import { StaleUsuryRateBanner } from '@/features/usuryRates/StaleUsuryRateBanner';

import type { ReactNode } from 'react';

// Matches Figma frame 52:95 ("F-16/17 / Préstamos — Desktop 1440"), with
// deliberate departures from the mockup — see
// apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps":
//   - "Rango de fechas" filter dropped: QueryLoansDto has no date filter.
//   - "Mensaje" row action dropped: manual WhatsApp send is Phase 5/9.
//   - The top-right "ADMIN" pill dropped: duplicates the Sidebar's own
//     user footer — this app has no separate header bar (see AppLayout.tsx).
// "Todos los estados" was keepable (unlike Clientes' "Todos" tab) since
// QueryLoansDto.status is a plain optional enum filter, not the
// true/false-only isActive Clientes originally had.
type StatusFilter = 'all' | LoanStatus;

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  { value: LoanStatus.Active, label: 'Activos' },
  { value: LoanStatus.Paid, label: 'Pagados' },
  { value: LoanStatus.Refinanced, label: 'Refinanciados' },
];

export function LoansListPage() {
  const { user } = useAuth();
  // Phase 23 — POST /loans moved off @Roles(Admin) onto
  // @RequireModule(AppModule.Loans), so a collector granted the loans
  // module can create a loan too. Mirrors RequirePermission.tsx's check.
  const canCreateLoan = Boolean(
    user && (user.role === 'admin' || user.modules.includes('loans')),
  );

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [isCreating, setIsCreating] = useState(false);

  const { data, isLoading, isError } = useLoans({
    search: search || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    page,
  });
  const createLoan = useCreateLoan();

  const loans = data?.items ?? [];
  const meta = data?.meta;
  const rowNumberOffset = ((meta?.page ?? 1) - 1) * (meta?.limit ?? 0);

  return (
    <div className="flex flex-col gap-5">
      <Header title="Préstamos" subtitle="Gestión de todos los préstamos" />

      {canCreateLoan && <StaleUsuryRateBanner />}

      <div className="border-t border-border" />

      <div className="flex h-10 items-center gap-3">
        <div className="flex h-[38px] w-[220px] items-center gap-2 rounded bg-input px-3">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar cliente…"
            className="w-full bg-transparent text-small text-white placeholder-mid focus:outline-none"
          />
        </div>

        <Select
          value={statusFilter}
          onChange={(next) => {
            setStatusFilter(next as StatusFilter);
            setPage(1);
          }}
          options={STATUS_FILTER_OPTIONS}
          className="w-[190px]"
        />

        <div className="flex-1" />

        {canCreateLoan && (
          <Button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5"
          >
            {/* An SVG here instead of a literal "+" character — the glyph
                rendered visibly clipped at the bottom in this font/weight
                at this size. */}
            <svg
              className="size-3.5 shrink-0"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
            >
              <path
                d="M10 4v12M4 10h12"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
            Nuevo préstamo
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg bg-surface">
        <table className="w-full">
          <thead className="bg-input">
            <tr>
              <Th className="w-12">#</Th>
              <Th>ID</Th>
              <Th>Cliente</Th>
              <Th>Monto (s/inc.)</Th>
              <Th>Saldo (c/inc.)</Th>
              <Th>Cuotas</Th>
              <Th>Días mora</Th>
              <Th>Estado</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <EmptyRow>Cargando…</EmptyRow>}
            {isError && (
              <EmptyRow tone="error">
                No se pudo cargar la lista de préstamos.
              </EmptyRow>
            )}
            {!isLoading && !isError && loans.length === 0 && (
              <EmptyRow>No se encontraron préstamos.</EmptyRow>
            )}
            {loans.map((loan, index) => (
              <LoanRow
                key={loan.id}
                loan={loan}
                rowNumber={rowNumberOffset + index + 1}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 text-label text-muted">
        <span>Días mora:</span>
        <Legend tone="success" label="0 días" />
        <Legend tone="warning" label="1–30" />
        <Legend tone="mora-mid" label="31–60" />
        <Legend tone="danger" label="+60" />
      </div>

      {meta && meta.total > 0 && (
        <div className="flex h-8 items-center justify-between">
          <p className="text-label text-muted">
            Mostrando {loans.length} de {meta.total} préstamos
          </p>
          <div className="flex items-center gap-1">
            <PageButton
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              ←
            </PageButton>
            {Array.from(
              { length: meta.totalPages },
              (_, index) => index + 1,
            ).map((pageNumber) => (
              <PageButton
                key={pageNumber}
                isActive={pageNumber === page}
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </PageButton>
            ))}
            <PageButton
              disabled={page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              →
            </PageButton>
          </div>
        </div>
      )}

      {isCreating && (
        <LoanForm
          onClose={() => setIsCreating(false)}
          onSubmit={(input) => createLoan.mutateAsync(input)}
        />
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
        colSpan={9}
        className={`p-6 text-center text-small ${tone === 'error' ? 'text-danger' : 'text-muted'}`}
      >
        {children}
      </td>
    </tr>
  );
}

function PageButton({
  children,
  onClick,
  isActive = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2.5 py-1.5 text-label ${
        isActive
          ? 'bg-border font-medium text-white'
          : 'bg-input text-muted disabled:opacity-40'
      }`}
    >
      {children}
    </button>
  );
}
