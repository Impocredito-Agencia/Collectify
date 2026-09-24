import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Legend } from '@/components/ui/Legend';
import { Pager } from '@/components/ui/Pager';
import { Select } from '@/components/ui/Select';
import { Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/useAuth';
import { LoanForm } from '@/features/loans/LoanForm';
import { estadoBadge } from '@/features/loans/loanStatusDisplay';
import { LoanRow } from '@/features/loans/LoanRow';
import { LoanStatus } from '@/features/loans/loansApi';
import { useCreateLoan, useLoans } from '@/features/loans/useLoans';
import { StaleUsuryRateBanner } from '@/features/usuryRates/StaleUsuryRateBanner';
import { useSessionState } from '@/lib/useSessionState';
import { useSortableColumn } from '@/lib/useSortableColumn';

import type { LoanSummary } from '@/features/loans/loansApi';
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

// Human report, 2026-09-22 — sortable columns, client-side over whatever
// page is currently loaded (see useSortableColumn.ts's own comment).
type LoanSortColumn =
  | 'promissoryNoteNumber'
  | 'clientFullName'
  | 'outstandingBalance'
  | 'overdueDays'
  | 'status';

// Ascending comparator — toggleSort's own asc/desc flip negates this.
// promissoryNoteNumber/clientFullName use numeric: true so a pagaré like
// "#2" sorts before "#743" (a plain string compare would put "101" first,
// per promissoryNoteNumberSort.ts's identical backend concern). status
// sorts by the same derived label estadoBadge shows ("Al día"/"En
// mora"/"Pagado"/"Refinanciado"), not the raw enum value, so it matches
// what's actually on screen.
function compareLoans(a: LoanSummary, b: LoanSummary, column: LoanSortColumn) {
  switch (column) {
    case 'promissoryNoteNumber':
      return a.promissoryNoteNumber.localeCompare(
        b.promissoryNoteNumber,
        'es',
        {
          numeric: true,
        },
      );
    case 'clientFullName':
      return a.clientFullName.localeCompare(b.clientFullName, 'es');
    case 'outstandingBalance':
      return a.outstandingBalance - b.outstandingBalance;
    case 'overdueDays':
      return a.overdueDays - b.overdueDays;
    case 'status':
      return estadoBadge(a).label.localeCompare(estadoBadge(b).label, 'es');
  }
}

export function LoansListPage() {
  const { user } = useAuth();
  // Phase 23 — POST /loans moved off @Roles(Admin) onto
  // @RequireModule(AppModule.Loans), so a collector granted the loans
  // module can create a loan too. Mirrors RequirePermission.tsx's check.
  const canCreateLoan = Boolean(
    user && (user.role === 'admin' || user.modules.includes('loans')),
  );

  // Human report, 2026-09-23 — kept across opening a pagaré and coming
  // back, so a search doesn't have to be retyped; see useSessionState.
  const [search, setSearch] = useSessionState('loans.list.search', '');
  const [statusFilter, setStatusFilter] = useSessionState<StatusFilter>(
    'loans.list.statusFilter',
    'all',
  );
  const [page, setPage] = useSessionState('loans.list.page', 1);
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

  // Human report, 2026-09-22 — "que se pueda filtrar por columna... de
  // menor a mayor y si la vuelve a tocar de mayor a menor". Sorts a copy
  // of the current page only — the underlying query (search/status
  // filter/page) is untouched.
  const {
    column: sortColumn,
    direction: sortDirection,
    toggle: toggleSort,
    directionFor,
  } = useSortableColumn<LoanSortColumn>('loans.list.sort');
  const sortedLoans = sortColumn
    ? [...loans].sort(
        (a, b) =>
          (sortDirection === 'asc' ? 1 : -1) * compareLoans(a, b, sortColumn),
      )
    : loans;

  // QoL, 2026-09-10 — rendered both above and below the table (same fix
  // as ClientsListPage.tsx) so paging doesn't require scrolling to the
  // bottom first. Built once here rather than duplicated at both JSX
  // spots, so the two copies can never drift out of sync.
  const paginationBar = meta && meta.total > 0 && (
    <div className="flex h-8 items-center justify-between">
      <p className="text-label text-muted">
        Mostrando {loans.length} de {meta.total} préstamos
      </p>
      <Pager page={page} totalPages={meta.totalPages} onPageChange={setPage} />
    </div>
  );

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

      {/* QoL, 2026-09-10 — the pager used to live only below the table;
          same block above and below now (see the comment above
          paginationBar) so paging doesn't require scrolling down first. */}
      {paginationBar}

      {/* Style cleanup, 2026-09-06 — same table-fixed recipe as Clientes'
          list (itself copied from LoanQuotePage's schedule-preview table):
          give an explicit, content-sized width to the ONE column whose
          content is genuinely fixed-size ("#" — a row number), leave every
          OTHER column with no width at all so table-fixed splits the
          remaining row width EQUALLY across them, and put column borders
          (divide-x) alongside the existing row borders. Headers/data are
          centered to match, except "#" (untouched) and "Cliente" — its
          header centers with the rest, but the name itself stays
          left-aligned, same "Nombre" treatment as Clientes' list. */}
      <div className="overflow-x-auto rounded-lg bg-surface">
        <table className="w-full min-w-[880px] table-fixed">
          <thead className="bg-input">
            <tr className="divide-x divide-border">
              <Th className="w-10 whitespace-nowrap">#</Th>
              <Th
                className="w-24 whitespace-nowrap"
                style={{ textAlign: 'center' }}
                sortDirection={directionFor('promissoryNoteNumber')}
                onSort={() => toggleSort('promissoryNoteNumber')}
              >
                ID
              </Th>
              <Th
                style={{ textAlign: 'center' }}
                sortDirection={directionFor('clientFullName')}
                onSort={() => toggleSort('clientFullName')}
              >
                Cliente
              </Th>
              <Th
                style={{ textAlign: 'center' }}
                sortDirection={directionFor('outstandingBalance')}
                onSort={() => toggleSort('outstandingBalance')}
              >
                Saldo total (capital + incremento)
              </Th>
              <Th style={{ textAlign: 'center' }}>Cuotas</Th>
              <Th
                style={{ textAlign: 'center' }}
                sortDirection={directionFor('overdueDays')}
                onSort={() => toggleSort('overdueDays')}
              >
                Días mora
              </Th>
              <Th
                style={{ textAlign: 'center' }}
                sortDirection={directionFor('status')}
                onSort={() => toggleSort('status')}
              >
                Estado
              </Th>
              <Th
                className="w-32 whitespace-nowrap"
                style={{ textAlign: 'center' }}
              >
                Acciones
              </Th>
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
            {sortedLoans.map((loan, index) => (
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

      {paginationBar}

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
        colSpan={8}
        className={`p-6 text-center text-small ${tone === 'error' ? 'text-danger' : 'text-muted'}`}
      >
        {children}
      </td>
    </tr>
  );
}

// Pagination controls (prev/next + page numbers) now use the shared
// Pager component (2026-09-05) — see @/components/ui/Pager.tsx. Previously
// rendered one FilterTab per page with no truncation, unlike Clientes'
// already-windowed pager.
