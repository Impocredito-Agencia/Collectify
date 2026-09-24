import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { DatePicker } from '@/components/ui/DatePicker';
import { Pager } from '@/components/ui/Pager';
import { RowActionButton } from '@/components/ui/RowActionButton';
import { Select } from '@/components/ui/Select';
import { Td, Th } from '@/components/ui/Table';
import {
  formatAuditAction,
  formatAuditEntityType,
} from '@/features/auditLogs/auditLogLabels';
import {
  useAuditActions,
  useAuditActors,
  useAuditLogs,
} from '@/features/auditLogs/useAuditLogs';
import { useDebouncedValue } from '@/lib/useDebouncedValue';

import type { ReactNode } from 'react';

// No Figma frame for this phase (docs/phases/PHASE_11_AUDIT_LOG.md /
// docs/phasesClient/PHASE_11_AUDIT_LOG.md) — built reusing
// MessageLogsPage.tsx's exact skeleton (filters row, paginated table, row
// click opens a detail drawer), the closest existing "browse a log"
// screen.
//
// Filters (2026-09-23, human report — finding anything was hard: "Acción"
// wanted a raw code like client.create, "Usuario" a pasted UUID):
//   - one search box for a client (name/cédula/phone) or a pagaré number,
//     several words allowed; the backend also returns what happened to that
//     client's/pagaré's loans and payments, not just entries whose label
//     mentions the words.
//   - Entidad/Acción/Usuario are dropdowns fed by what is actually in the
//     trail (GET /audit-logs/actions, /actors) instead of hardcoded lists
//     or pasted ids. Picking an Entidad narrows the Acción list to that
//     entity's actions.
const ALL = 'all';

// A single character would match nearly everything and is almost always a
// half-typed word — wait for a real term before querying.
const MIN_SEARCH_LENGTH = 2;

const SEARCH_HELP =
  'Escribe un nombre, cédula o número de pagaré. Al buscar un cliente también salen los movimientos de sus pagarés y pagos. Con varias palabras (ej: Juana 0928) deben cumplirse todas.';

export function AuditLogsPage() {
  const [searchInput, setSearchInput] = useState('');
  const [actorUserId, setActorUserId] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [entityTypeFilter, setEntityTypeFilter] = useState(ALL);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const search = useDebouncedValue(searchInput.trim());
  const { data: actions = [] } = useAuditActions();
  const { data: actors = [] } = useAuditActors();

  const { data, isLoading, isError } = useAuditLogs({
    search: search.length >= MIN_SEARCH_LENGTH ? search : undefined,
    actorUserId: actorUserId === ALL ? undefined : actorUserId,
    action: action === ALL ? undefined : action,
    entityType: entityTypeFilter === ALL ? undefined : entityTypeFilter,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
  });

  const entries = data?.items ?? [];
  const meta = data?.meta;

  const entityTypeOptions = [
    { value: ALL, label: 'Todas las entidades' },
    ...[...new Set(actions.map((option) => option.entityType))]
      .map((entityType) => ({
        value: entityType,
        label: formatAuditEntityType(entityType),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es')),
  ];

  const actionsForEntity = actions.filter(
    (option) =>
      entityTypeFilter === ALL || option.entityType === entityTypeFilter,
  );
  const actionOptions = [
    { value: ALL, label: 'Todas las acciones' },
    ...actionsForEntity
      .map((option) => ({
        value: option.action,
        label: formatAuditAction(option.action),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es')),
  ];

  const actorOptions = [
    { value: ALL, label: 'Todos los usuarios' },
    ...actors.map((actor) => ({ value: actor.id, label: actor.fullName })),
  ];

  const hasActiveFilters =
    searchInput.trim() !== '' ||
    actorUserId !== ALL ||
    action !== ALL ||
    entityTypeFilter !== ALL ||
    dateFrom !== '' ||
    dateTo !== '';

  const clearFilters = () => {
    setSearchInput('');
    setActorUserId(ALL);
    setAction(ALL);
    setEntityTypeFilter(ALL);
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Auditoría"
        subtitle="Quién hizo qué, y cuándo, en el sistema"
      />

      <div className="flex flex-col gap-2">
        <div className="flex h-[38px] max-w-[640px] items-center gap-2 rounded bg-input px-3">
          <input
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar por cliente, cédula o número de pagaré…"
            aria-label="Buscar en la auditoría"
            className="w-full bg-transparent text-small text-white placeholder-mid focus:outline-none"
          />
        </div>
        <p className="max-w-[640px] text-meta text-muted">{SEARCH_HELP}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
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
            setEntityTypeFilter(next);
            // The chosen action may not belong to the new entity — keeping
            // it would silently return nothing.
            const stillValid =
              next === ALL ||
              actions.some(
                (option) =>
                  option.action === action && option.entityType === next,
              );
            if (!stillValid) {
              setAction(ALL);
            }
            setPage(1);
          }}
          options={entityTypeOptions}
          className="w-[190px]"
        />

        <Select
          value={action}
          onChange={(next) => {
            setAction(next);
            setPage(1);
          }}
          options={actionOptions}
          className="w-[280px]"
        />

        <Select
          value={actorUserId}
          onChange={(next) => {
            setActorUserId(next);
            setPage(1);
          }}
          options={actorOptions}
          className="w-[210px]"
        />

        {hasActiveFilters && (
          <RowActionButton onClick={clearFilters}>
            Limpiar filtros
          </RowActionButton>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg bg-surface">
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
        <table className="w-full min-w-[480px] table-fixed">
          <thead className="bg-input">
            <tr>
              <Th className="w-[210px]">Actor</Th>
              <Th className="w-[324px]">Acción</Th>
              <Th>Entidad</Th>
              <Th className="w-[176px]">Fecha</Th>
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
              <EmptyRow>
                {hasActiveFilters
                  ? 'No se encontraron registros con estos filtros.'
                  : 'No se encontraron registros.'}
              </EmptyRow>
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
