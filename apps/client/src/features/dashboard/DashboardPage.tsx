import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Pager } from '@/components/ui/Pager';
import { RowActionButton } from '@/components/ui/RowActionButton';
import { Select } from '@/components/ui/Select';
import { StatCard } from '@/components/ui/StatCard';
import { Td, Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/useAuth';
import { OverdueClientsSortBy } from '@/features/dashboard/dashboardApi';
import {
  useDashboardSummary,
  useOverdueClients,
} from '@/features/dashboard/useDashboard';
import { moraBadgeClasses } from '@/features/loans/loanStatusDisplay';
import { useCurrentUsuryRate } from '@/features/usuryRates/useUsuryRates';
import { formatCurrency } from '@/lib/format';

import type { ReactNode } from 'react';

const SORT_OPTIONS = [
  { value: OverdueClientsSortBy.TotalOverdueAmount, label: 'Monto total' },
  { value: OverdueClientsSortBy.MaxOverdueDays, label: 'Días de mora' },
];

// No new Figma design was reviewed for this screen — client explicitly
// chose (see AskUserQuestion during Fase 7) to build it from scratch
// against the real GET /dashboard/* contract, following the same
// KPI-card/sortable-table patterns already established elsewhere in the
// app (ClientDetailPage's stat cards, LoansListPage's sortable/paginated
// table), rather than reconstructing the pasted screenshots from memory.
// Same 3 real endpoints for both roles — the backend has no "collector
// assigned to client" concept anywhere in the data model, so the
// Cobrador-specific KPIs from that earlier screenshot ("Mis asignados",
// "Contactados", "Recaudado") aren't backed by anything real and were never
// built. What IS role-gated (client's explicit rule, post-review): a
// cobrador must not see any monetary figure except the overdue-clients
// list itself (needed to actually collect) — "Monto total en mora",
// "Cartera total vigente" (2026-09-05) and "Pagos recibidos" are admin-only
// cards. "% de cartera en mora" and "Tasa de usura vigente" are ratios, not
// exact peso amounts, so both roles see those. See DESIGN_TOKENS.md.
export function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [sortBy, setSortBy] = useState<OverdueClientsSortBy>(
    OverdueClientsSortBy.TotalOverdueAmount,
  );
  const [page, setPage] = useState(1);

  const { data: summary, isLoading: summaryLoading } = useDashboardSummary();
  const { data: currentUsuryRate } = useCurrentUsuryRate();
  const {
    data: overdueClients,
    isLoading: overdueLoading,
    isError: overdueError,
  } = useOverdueClients({ sortBy, page });

  const clients = overdueClients?.items ?? [];
  const meta = overdueClients?.meta;

  return (
    <div className="flex flex-col gap-5">
      <Header title="Dashboard" subtitle="Resumen general de la cartera" />

      <div className="flex flex-col gap-2.5">
        <span className="text-section-label font-normal tracking-normal text-subtle">
          Cartera
        </span>

        {/* Grid fijo a 4 columnas (no dependiente del conteo de tarjetas) —
            así el ancho de cada tarjeta es siempre el mismo sin importar
            cuántas haya, y las filas se acomodan solas por wrap en vez de
            forzar todo en una sola fila cada vez más angosta. Fila 1:
            conteos de cartera/cobranza. Fila 2: proporciones (% en mora,
            tasa de usura, ambos roles) + los dos montos exactos en pesos
            que siguen siendo admin-only (misma regla de siempre — ver
            comentario arriba). Para el cobrador la fila 2 solo tiene 2
            tarjetas y deja las otras 2 columnas vacías; se prefirió eso a
            estirar las tarjetas para llenar el espacio. */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Clientes con préstamos activos"
            value={
              summaryLoading ? '—' : String(summary?.totalActiveClients ?? 0)
            }
          />
          <StatCard
            label="Préstamos activos"
            value={
              summaryLoading ? '—' : String(summary?.totalActiveLoans ?? 0)
            }
          />
          <StatCard
            label="Cuotas en mora"
            value={
              summaryLoading
                ? '—'
                : String(summary?.totalOverdueInstallments ?? 0)
            }
          />
          <StatCard
            label="Cuotas por vencer (próximos 5 días)"
            value={
              summaryLoading
                ? '—'
                : String(summary?.upcomingDueInstallments ?? 0)
            }
          />
          <StatCard
            label="% de cartera en mora"
            value={summaryLoading ? '—' : `${summary?.overdueRate ?? 0}%`}
          />
          <StatCard
            label="Tasa de usura vigente"
            value={
              currentUsuryRate ? `${currentUsuryRate.ratePercentage}%` : '—'
            }
          />
          {isAdmin && (
            <StatCard
              label="Cartera total vigente"
              value={
                summaryLoading
                  ? '—'
                  : formatCurrency(summary?.totalOutstandingPrincipal ?? 0)
              }
            />
          )}
          {isAdmin && (
            <StatCard
              label="Monto total en mora"
              value={
                summaryLoading
                  ? '—'
                  : formatCurrency(summary?.totalAmountOverdue ?? 0)
              }
            />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-section-label font-normal tracking-normal text-subtle">
          Mensajería
        </span>

        {/* Mismo grid-cols-4 que Cartera arriba, aunque solo haya 2
            tarjetas — así quedan del mismo ancho que las de Cartera en vez
            de estirarse para llenar la fila (lo que se veía como cajas
            enormes y vacías con un solo número adentro). */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Mensajes enviados esta semana"
            value={
              summaryLoading ? '—' : String(summary?.messagesSentThisWeek ?? 0)
            }
          />
          <StatCard
            label="Mensajes fallidos esta semana"
            value={
              summaryLoading
                ? '—'
                : String(summary?.messagesFailedThisWeek ?? 0)
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-section-label font-normal tracking-normal text-subtle">
            Clientes en mora
          </span>
          <div className="flex items-center gap-2">
            <span className="text-label text-muted">Ordenar por</span>
            <Select
              value={sortBy}
              onChange={(next) => {
                setSortBy(next as OverdueClientsSortBy);
                setPage(1);
              }}
              options={SORT_OPTIONS}
              className="w-[160px]"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg bg-surface">
          <table className="w-full min-w-[640px]">
            <thead className="bg-input">
              <tr>
                <Th>Cliente</Th>
                <Th>Monto total en mora</Th>
                <Th>Cuotas vencidas</Th>
                <Th>Días de mora</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {overdueLoading && <EmptyRow>Cargando…</EmptyRow>}
              {overdueError && (
                <EmptyRow tone="error">
                  No se pudo cargar la lista de clientes en mora.
                </EmptyRow>
              )}
              {!overdueLoading && !overdueError && clients.length === 0 && (
                <EmptyRow>
                  Ningún cliente tiene cuotas en mora ahora mismo.
                </EmptyRow>
              )}
              {clients.map((client) => (
                <tr key={client.clientId} className="border-t border-border">
                  <Td>
                    {client.firstName} {client.lastName}
                  </Td>
                  <Td>{formatCurrency(client.totalOverdueAmount)}</Td>
                  <Td>{client.overdueInstallmentsCount}</Td>
                  <Td>
                    <span
                      className={`rounded-[3px] border px-2 py-[3px] text-meta font-medium ${moraBadgeClasses(client.maxOverdueDays)}`}
                    >
                      {client.maxOverdueDays} días
                    </span>
                  </Td>
                  <Td>
                    <RowActionButton to={`/clientes/${client.clientId}`}>
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
              Mostrando {clients.length} de {meta.total} clientes
            </p>
            <Pager
              page={page}
              totalPages={meta.totalPages}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {/* "Reporte mensual" section removed from the UI (2026-09-05, client
          request) — not needed for day-to-day use right now. The backend
          endpoint (GET /dashboard/monthly-report), dashboardApi.ts's
          getMonthlyReport, and useDashboard.ts's useMonthlyReport hook were
          all deliberately left in place, untouched, in case this is wanted
          again later — only this page's usage of them was removed. */}
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
        colSpan={5}
        className={`p-6 text-center text-small ${tone === 'error' ? 'text-danger' : 'text-muted'}`}
      >
        {children}
      </td>
    </tr>
  );
}

// Pagination controls now use the shared Pager component (2026-09-05) —
// see @/components/ui/Pager.tsx. Previously rendered one FilterTab per
// page with no truncation, unlike Clientes' already-windowed pager.
