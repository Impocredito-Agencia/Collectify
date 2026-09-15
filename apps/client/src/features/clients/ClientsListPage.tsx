import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { FilterTab } from '@/components/ui/FilterTab';
import { Pager } from '@/components/ui/Pager';
import { Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/useAuth';
import { ClientForm } from '@/features/clients/ClientForm';
import { ClientRow } from '@/features/clients/ClientRow';
import { DeactivateClientDialog } from '@/features/clients/DeactivateClientDialog';
import { ImportClientsDialog } from '@/features/clients/ImportClientsDialog';
import {
  useClients,
  useCreateClient,
  useDeleteClient,
  useReactivateClient,
  useUpdateClient,
} from '@/features/clients/useClients';
import { ApiError } from '@/lib/apiClient';

import type { Client } from '@/features/clients/clientsApi';
import type { ReactNode } from 'react';

// Matches Figma frame 40:3 ("F-10 / Clientes — Desktop 1440"), with one
// remaining deliberate departure from the mockup — see
// apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps":
//   - "Última actividad" column dropped: not backed by any endpoint.
//   - "Préstamos" was dropped for the same reason but came back
//     (2026-09-06) as two columns — "Préstamos activos" (count) and
//     "En mora" (max overdueDays across the client's active loans) —
//     backed by ClientsService.enrichClientListItems, batched per page
//     rather than per row.
// The "Importar Excel" button noted as dropped here previously is now
// built — see ImportClientsDialog.tsx (Phase 8 scope, confirmed with the
// client 2026-08-19). Relabeled "Importar clientes" (2026-09-06) once the
// backend split the old combined clients+loans importer in two — this
// dialog only ever creates clients now, see ImportClientsDialog.tsx's own
// comment.
// The "Todos" tab WAS missing for the same reason (isActive was a strict
// true/false), but that turned out to be worth fixing rather than dropping
// — ClientsService.findAll/QueryClientsDto now accept isActive: 'all'.
type StatusFilter = 'all' | 'active' | 'inactive';

const STATUS_FILTER_TO_IS_ACTIVE: Record<StatusFilter, boolean | 'all'> = {
  all: 'all',
  active: true,
  inactive: false,
};

export function ClientsListPage() {
  const { user } = useAuth();
  // Phase 20 — was isAdmin. Gates "Nuevo cliente"/"Importar clientes"
  // (ClientsController/ClientsImportController) and the row actions
  // passed down to ClientRow — both migrated to
  // @RequireModule(AppModule.Clients). See
  // docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
  const canManageClient = Boolean(
    user && (user.role === 'admin' || user.modules.includes('clients')),
  );

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [page, setPage] = useState(1);

  const [editingClient, setEditingClient] = useState<Client | 'new' | null>(
    null,
  );
  const [deactivatingClient, setDeactivatingClient] = useState<Client | null>(
    null,
  );
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useClients({
    search: search || undefined,
    isActive: STATUS_FILTER_TO_IS_ACTIVE[statusFilter],
    page,
  });

  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const reactivateClient = useReactivateClient();
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  const clients = data?.items ?? [];
  const meta = data?.meta;
  // First row number on the current page — see rowNumber comment below.
  const rowNumberOffset = ((meta?.page ?? 1) - 1) * (meta?.limit ?? 0);

  // QoL, 2026-09-10 — rendered both above and below the table (see the
  // comment at the top call site) so paging doesn't require scrolling to
  // the bottom first. Built once here rather than duplicated at both JSX
  // spots, so the two copies can never drift out of sync.
  const paginationBar = meta && meta.total > 0 && (
    <div className="flex h-8 items-center justify-between">
      <p className="text-label text-muted">
        Mostrando {clients.length} de {meta.total} clientes
      </p>
      <Pager page={page} totalPages={meta.totalPages} onPageChange={setPage} />
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <Header title="Clientes" subtitle="Gestión de todos los clientes" />

      <div className="border-t border-border" />

      <div className="flex h-10 items-center gap-3">
        <div className="flex h-[38px] w-[280px] items-center gap-2 rounded bg-input px-3">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nombre, cédula o celular…"
            className="w-full bg-transparent text-small text-white placeholder-mid focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1">
          <FilterTab
            label="Todos"
            isActive={statusFilter === 'all'}
            onClick={() => {
              setStatusFilter('all');
              setPage(1);
            }}
          />
          <FilterTab
            label="Activos"
            isActive={statusFilter === 'active'}
            onClick={() => {
              setStatusFilter('active');
              setPage(1);
            }}
          />
          <FilterTab
            label="Inactivos"
            isActive={statusFilter === 'inactive'}
            onClick={() => {
              setStatusFilter('inactive');
              setPage(1);
            }}
          />
        </div>

        <div className="flex-1" />

        {canManageClient && (
          <Button
            variant="secondary"
            onClick={() => setIsImportDialogOpen(true)}
          >
            Importar clientes
          </Button>
        )}

        {canManageClient && (
          <Button
            onClick={() => setEditingClient('new')}
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
            Nuevo cliente
          </Button>
        )}
      </div>

      {isImportDialogOpen && (
        <ImportClientsDialog
          onClose={() => setIsImportDialogOpen(false)}
          onImported={() =>
            void queryClient.invalidateQueries({ queryKey: ['clients'] })
          }
        />
      )}

      {/* QoL, 2026-09-10 — the pager used to live only below the table,
          which meant paging past a long list required scrolling all the
          way down first. Same block rendered above and below now (stored
          once so the two copies can't drift), sandwiching the table. */}
      {paginationBar}

      <div className="overflow-hidden rounded-lg bg-surface">
        {/* Style cleanup, 2026-09-06 (client feedback — hand-tuned
            per-column percentages, "no podemos acomodar una por una",
            still didn't distribute the row's width well). Replaced with
            the same table-fixed recipe LoanQuotePage's schedule-preview
            table already uses successfully: give an explicit, content-sized
            width to the ONE column whose content is genuinely fixed-size
            ("#" — a row number never needs more than a couple of digits —
            same role "Cuota" plays there), and leave every OTHER column
            with no width at all. table-fixed then splits 100% of the
            remaining row width EQUALLY across those columns automatically —
            no more guessing percentages by content type, and no leftover
            unused space on wide screens. */}
        <table className="w-full table-fixed">
          <thead className="bg-input">
            <tr className="divide-x divide-border">
              <Th className="w-10 whitespace-nowrap">#</Th>
              {/* Human request, 2026-09-15 — some full names wrapped to two
                  lines under the equal-split width every other column
                  still uses. Fixed at 256px, wide enough for a real
                  two-given-name + two-surname Colombian name at this font
                  size, without touching the rest of the table-fixed
                  recipe above. */}
              <Th className="w-64" style={{ textAlign: 'center' }}>
                Nombre
              </Th>
              <Th style={{ textAlign: 'center' }}>Cédula</Th>
              <Th style={{ textAlign: 'center' }}>Celular</Th>
              <Th style={{ textAlign: 'center' }}>Préstamos activos</Th>
              <Th style={{ textAlign: 'center' }}>En mora</Th>
              <Th style={{ textAlign: 'center' }}>Estado</Th>
              <Th style={{ textAlign: 'center' }}>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <EmptyRow>Cargando…</EmptyRow>}
            {isError && (
              <EmptyRow tone="error">
                No se pudo cargar la lista de clientes.
              </EmptyRow>
            )}
            {!isLoading && !isError && clients.length === 0 && (
              <EmptyRow>No se encontraron clientes.</EmptyRow>
            )}
            {clients.map((client, index) => (
              <ClientRow
                key={client.id}
                client={client}
                // Purely a display sequence, not a backend field. See F-10
                // in the requirements table.
                rowNumber={rowNumberOffset + index + 1}
                canManageClient={canManageClient}
                onEdit={() => setEditingClient(client)}
                onDeactivate={() => setDeactivatingClient(client)}
                onReactivate={async () => {
                  setReactivateError(null);
                  try {
                    await reactivateClient.mutateAsync(client.id);
                  } catch (err) {
                    setReactivateError(
                      err instanceof ApiError
                        ? err.message
                        : 'No se pudo reactivar el cliente.',
                    );
                  }
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {reactivateError && (
        <p className="text-small text-danger" role="alert">
          {reactivateError}
        </p>
      )}

      {paginationBar}

      {editingClient && (
        <ClientForm
          client={editingClient === 'new' ? undefined : editingClient}
          onClose={() => setEditingClient(null)}
          onSubmit={(input) =>
            editingClient === 'new'
              ? createClient.mutateAsync(input)
              : updateClient.mutateAsync({ id: editingClient.id, input })
          }
        />
      )}

      {deactivatingClient && (
        <DeactivateClientDialog
          clientName={`${deactivatingClient.firstName} ${deactivatingClient.lastName}`}
          onClose={() => setDeactivatingClient(null)}
          onConfirm={() => deleteClient.mutateAsync(deactivatingClient.id)}
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

// Pagination controls now use the shared Pager component (see
// @/components/ui/Pager.tsx) — this page's own buildPageWindow() and
// pager JSX were extracted from here (2026-09-05) so Dashboard, Loans,
// MessageLogs and AuditLogs could all get the same 50/page + 5-window
// treatment instead of a 5th near-identical copy.
