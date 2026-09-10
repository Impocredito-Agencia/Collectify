import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { DatePicker } from '@/components/ui/DatePicker';
import { Pager } from '@/components/ui/Pager';
import { Select } from '@/components/ui/Select';
import { Td, Th } from '@/components/ui/Table';
import {
  formatAuditAction,
  formatAuditEntityType,
} from '@/features/auditLogs/auditLogLabels';
import { useAuditLogs } from '@/features/auditLogs/useAuditLogs';

import type { ReactNode } from 'react';

// No Figma frame for this phase (docs/phases/PHASE_11_AUDIT_LOG.md /
// docs/phasesClient/PHASE_11_AUDIT_LOG.md) — built reusing
// MessageLogsPage.tsx's exact skeleton (filters row, paginated table, row
// click opens a detail drawer), the closest existing "browse a log"
// screen.
//
// "Actor" is a plain text filter (pasted user id), not a dropdown of real
// admins/collectors — there is no frontend Users management feature to
// source that list from yet (Phase 8's backend Users module exists, but
// its client-side UI was never actually merged into this branch lineage;
// see apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps"). If
// that feature lands later, this filter should switch to a Select sourced
// from GET /users.
type EntityTypeFilter = 'all' | 'client' | 'loan' | 'payment' | 'user';

// Mirrors the entityType values actually in use by @Audit()-decorated
// endpoints today (see apps/api/src/*/*.controller.ts). Extend this list
// as new actions are added — entityType itself is free text server-side,
// not a real enum (docs/phases/PHASE_11_AUDIT_LOG.md), so nothing breaks
// if a new value shows up that isn't in this dropdown; it just won't have
// a friendly filter option yet.
const ENTITY_TYPE_FILTER_OPTIONS = [
  { value: 'all', label: 'Todas las entidades' },
  { value: 'client', label: 'Cliente' },
  { value: 'loan', label: 'Préstamo' },
  { value: 'payment', label: 'Pago' },
  { value: 'user', label: 'Usuario' },
];

export function AuditLogsPage() {
  const [actorUserId, setActorUserId] = useState('');
  const [action, setAction] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] =
    useState<EntityTypeFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useAuditLogs({
    actorUserId: actorUserId || undefined,
    action: action || undefined,
    entityType: entityTypeFilter === 'all' ? undefined : entityTypeFilter,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
  });

  const entries = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Auditoría"
        subtitle="Quién hizo qué, y cuándo, en el sistema"
      />

      <div className="flex h-10 items-center gap-3">
        {/* Style cleanup, 2026-09-05 (client feedback) — the two date
            pickers used to be visually identical (same size, same empty
            "dd/mm/aaaa" placeholder), with "Desde"/"Hasta" only present as
            an invisible aria-label. A user landing on this page had no way
            to tell the two fields apart at a glance. A small visible
            caption in front of each fixes that without restructuring the
            filter bar's single-row layout. */}
        <div className="flex items-center gap-1.5">
          <span className="text-label text-muted">Desde</span>
          <DatePicker
            value={dateFrom}
            onChange={(next) => {
              setDateFrom(next);
              setPage(1);
            }}
            ariaLabel="Desde"
            className="h-[38px] w-[150px] rounded bg-input px-3 text-small text-muted"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-label text-muted">Hasta</span>
          <DatePicker
            value={dateTo}
            onChange={(next) => {
              setDateTo(next);
              setPage(1);
            }}
            ariaLabel="Hasta"
            className="h-[38px] w-[150px] rounded bg-input px-3 text-small text-muted"
          />
        </div>

        <Select
          value={entityTypeFilter}
          onChange={(next) => {
            setEntityTypeFilter(next as EntityTypeFilter);
            setPage(1);
          }}
          options={ENTITY_TYPE_FILTER_OPTIONS}
          className="w-[190px]"
        />

        <div className="flex h-[38px] w-[220px] items-center gap-2 rounded bg-input px-3">
          <input
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            placeholder="Acción, ej: client.create"
            className="w-full bg-transparent text-small text-white placeholder-mid focus:outline-none"
          />
        </div>

        <div className="flex h-[38px] w-[220px] items-center gap-2 rounded bg-input px-3">
          <input
            value={actorUserId}
            onChange={(event) => {
              setActorUserId(event.target.value);
              setPage(1);
            }}
            placeholder="ID de usuario actor…"
            className="w-full bg-transparent text-small text-white placeholder-mid focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-surface">
        {/* Human report, 2026-09-09 — a bulk payment's entityLabel (already
            shortened once, see auditLogLabels/the interceptor's
            formatCuotaGroupsLabel) can still run long, and with the
            default table-layout: auto the browser hands most of the
            table's width to whichever column has the longest content,
            squeezing Actor/Acción/Fecha down to near-unreadable widths.
            table-fixed + explicit widths on the other three columns makes
            their width immune to Entidad's content — Entidad (the one
            column left without an explicit width) absorbs whatever's left
            and wraps to as many lines as it needs, instead of stealing
            space from the rest. */}
        <table className="w-full table-fixed">
          <thead className="bg-input">
            <tr>
              <Th className="w-[210px]">Actor</Th>
              <Th className="w-[270px]">Acción</Th>
              <Th>Entidad</Th>
              <Th className="w-[160px]">Fecha</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <EmptyRow>Cargando…</EmptyRow>}
            {isError && (
              <EmptyRow tone="error">
                No se pudo cargar el historial de auditoría.
              </EmptyRow>
            )}
            {!isLoading && !isError && entries.length === 0 && (
              <EmptyRow>No se encontraron registros.</EmptyRow>
            )}
            {/* Style cleanup, 2026-09-05 (client feedback) — dropped the
                "Acciones" column + its "Ver detalle" drawer. The drawer's
                own top section (actor email, raw action code, full
                entityId) duplicated what this row already shows in
                friendlier form; its bottom section was a raw JSON dump of
                the request payload (field names like conceptTypeId,
                calculationType: "percentage") that no admin/cobrador user
                can act on — reviewing that shape is a job for whoever
                maintains the code, not this screen. Removing it also frees
                up real width for the remaining columns. */}
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-border">
                <Td>{entry.actorUser?.fullName ?? '—'}</Td>
                {/* Was raw "client.create" — meaningless at a glance to
                    anyone who isn't reading the backend's @Audit()
                    decorators. See auditLogLabels.ts. */}
                <Td muted>{formatAuditAction(entry.action)}</Td>
                {/* entityLabel ("Juana Pérez (CC 123456)", "Pagaré
                    #743") is what actually answers "which one?" — the
                    entityType alone just says which module. Falls back
                    to the old entityType + short id when no label could
                    be resolved (see AuditLog.entityLabel). */}
                <Td muted>
                  {entry.entityLabel ??
                    `${formatAuditEntityType(entry.entityType)}${
                      entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ''
                    }`}
                </Td>
                <Td muted>
                  {new Date(entry.createdAt).toLocaleString('es-CO', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta && meta.total > 0 && (
        <div className="flex h-8 items-center justify-between">
          <p className="text-label text-muted">
            Mostrando {entries.length} de {meta.total} registros
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
        colSpan={4}
        className={`p-6 text-center text-small ${tone === 'error' ? 'text-danger' : 'text-muted'}`}
      >
        {children}
      </td>
    </tr>
  );
}

// Pager component (2026-09-05) — see @/components/ui/Pager.tsx. Previously
// rendered one FilterTab per page with no truncation, unlike Clientes'
// already-windowed pager.
