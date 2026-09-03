import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { FilterTab } from '@/components/ui/FilterTab';
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
//   - "Préstamos" / "Última actividad" columns dropped: not backed by any
//     endpoint yet (arrive with Phase 4/7).
// The "Importar Excel" button noted as dropped here previously is now
// built — see ImportClientsDialog.tsx (Phase 8 scope, confirmed with the
// client 2026-08-19).
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
  const isAdmin = user?.role === 'admin';

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

        {isAdmin && (
          <Button
            variant="secondary"
            onClick={() => setIsImportDialogOpen(true)}
          >
            Importar Excel
          </Button>
        )}

        {isAdmin && (
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

      <div className="overflow-hidden rounded-lg bg-surface">
        <table className="w-full">
          <thead className="bg-input">
            <tr>
              <Th className="w-12">#</Th>
              <Th>Nombre</Th>
              <Th>Cédula</Th>
              <Th>Celular</Th>
              <Th>Estado</Th>
              <Th>Acciones</Th>
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
                isAdmin={isAdmin}
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

      {meta && meta.total > 0 && (
        <div className="flex h-8 items-center justify-between">
          <p className="text-label text-muted">
            Mostrando {clients.length} de {meta.total} clientes
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
        colSpan={6}
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
          : 'border border-border bg-input text-muted disabled:opacity-40'
      }`}
    >
      {children}
    </button>
  );
}
