import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { DatePicker } from '@/components/ui/DatePicker';
import { Legend } from '@/components/ui/Legend';
import { Pager } from '@/components/ui/Pager';
import { RowActionButton } from '@/components/ui/RowActionButton';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Td, Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/useAuth';
import { MessageLogDrawer } from '@/features/messageLogs/MessageLogDrawer';
import { MessageLogStatus } from '@/features/messageLogs/messageLogsApi';
import {
  useMessageLogs,
  useRetryMessageLog,
} from '@/features/messageLogs/useMessageLogs';
import {
  MESSAGE_TYPE_LABELS,
  MESSAGE_TYPE_ORDER,
  messageTypeLabel,
} from '@/features/messageTemplates/messageTemplatesApi';
import { ApiError } from '@/lib/apiClient';
import { formatPhoneNumber } from '@/lib/format';

import type { MessageLog } from '@/features/messageLogs/messageLogsApi';
import type { MessageType } from '@/features/messageTemplates/messageTemplatesApi';
import type { ReactNode } from 'react';

// Matches Figma F-23 "Mensajes — Desktop 1440". Originally scoped to
// type=overdue only (client's choice, Fase 5); Fase 9 lifted that scoping
// now that three more message types exist — see the "Tipo" column/filter
// below. Other departures from the mockup — see
// apps/client/docs/DESIGN_TOKENS.md "Known design/backend gaps":
//   - Estado only has two real values (Enviado/Fallido) — no delivery/read
//     receipt tracking exists. The summary counts follow the same split
//     instead of Figma's four categories.
//   - "AD ADMIN" pill dropped — redundant with the sidebar footer.
//   - "Rango de fechas" is two date inputs (Desde/Hasta) instead of a
//     single dropdown — simpler than guessing what preset ranges the
//     dropdown was meant to offer, and maps directly to the API's
//     dateFrom/dateTo params.
//   - Added (Fase 5), then moved (Phase 18): an admin-only pause/resume
//     control for the automatic sends used to live here, since no Figma
//     frame shows where it goes. Phase 18 generalized it to all 4 message
//     types and a per-template editable schedule, at which point it moved
//     to MessageTemplatesPage.tsx — a schedule is a property of the
//     template/type, not of this failed-sends list. This page keeps a
//     "Reintentar" action per failed row instead.
//   - Changed after go-live (confirmed with the client's colleague): this
//     page used to have a Todos/Enviados/Fallidos filter defaulting to
//     "Todos". It then always showed only failed/unsent messages — the
//     table was meant to be a to-do list of sends that need attention,
//     not a full audit log. Phase 32 dropped the "X Enviados" legend
//     count for the same reason, keeping only "X Fallidos".
//   - Reversed 2026-09-11 (human report): with WHATSAPP_SENDING_PAUSED
//     active and no access to the Meta WhatsApp Business panel yet, there
//     was no way at all to confirm a message that DID go out (e.g. to a
//     WHATSAPP_TEST_RECIPIENTS number) actually sent. The Todos/Enviados/
//     Fallidos filter and the "X Enviados" legend are both back — still
//     defaulting to Fallidos, so the day-to-day "to-do list" framing above
//     holds, but an admin can switch to Enviados/Todos to verify sends.
type TypeFilter = 'all' | MessageType;
type StatusFilter = 'all' | MessageLogStatus;

const TYPE_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos los tipos' },
  ...MESSAGE_TYPE_ORDER.map((type) => ({
    value: type,
    label: MESSAGE_TYPE_LABELS[type],
  })),
];

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  { value: MessageLogStatus.Sent, label: 'Enviados' },
  { value: MessageLogStatus.Failed, label: 'Fallidos' },
];

export function MessageLogsPage() {
  const { user } = useAuth();
  // Phase 20 — was isAdmin. Gates "Reintentar", the MessageLogsController
  // retry endpoint migrated to @RequireModule(AppModule.Messages) — see
  // docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
  const canRetryMessage = Boolean(
    user && (user.role === 'admin' || user.modules.includes('messages')),
  );

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    MessageLogStatus.Failed,
  );
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [openLog, setOpenLog] = useState<MessageLog | null>(null);

  // Defaults to Fallidos — see the comment block above for why, and for
  // when this was reversed to let it switch to Enviados/Todos too.
  const { data, isLoading, isError } = useMessageLogs({
    search: search || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    type: typeFilter === 'all' ? undefined : typeFilter,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
  });
  const { data: failedCount } = useMessageLogs({
    status: MessageLogStatus.Failed,
    limit: 1,
  });
  const { data: sentCount } = useMessageLogs({
    status: MessageLogStatus.Sent,
    limit: 1,
  });

  const retryMessageLog = useRetryMessageLog();

  const logs = data?.items ?? [];
  const meta = data?.meta;
  const rowNumberOffset = ((meta?.page ?? 1) - 1) * (meta?.limit ?? 0);

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Envíos fallidos"
        subtitle="Mensajes de WhatsApp que no se pudieron enviar"
      />

      {retryMessageLog.isError && (
        <p className="text-small text-danger" role="alert">
          {retryMessageLog.error instanceof ApiError
            ? retryMessageLog.error.message
            : 'No se pudo reintentar el mensaje.'}
        </p>
      )}

      <div className="flex h-10 items-center gap-3">
        <DatePicker
          value={dateFrom}
          onChange={(next) => {
            setDateFrom(next);
            setPage(1);
          }}
          ariaLabel="Desde"
          className="h-[38px] w-[150px] rounded bg-input px-3 text-small text-muted"
        />
        <DatePicker
          value={dateTo}
          onChange={(next) => {
            setDateTo(next);
            setPage(1);
          }}
          ariaLabel="Hasta"
          className="h-[38px] w-[150px] rounded bg-input px-3 text-small text-muted"
        />

        <Select
          value={statusFilter}
          onChange={(next) => {
            setStatusFilter(next as StatusFilter);
            setPage(1);
          }}
          options={STATUS_FILTER_OPTIONS}
          className="w-[190px]"
        />

        <Select
          value={typeFilter}
          onChange={(next) => {
            setTypeFilter(next as TypeFilter);
            setPage(1);
          }}
          options={TYPE_FILTER_OPTIONS}
          className="w-[190px]"
        />

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

        <div className="flex-1" />

        <div className="flex items-center gap-3 text-label text-muted">
          <Legend
            tone="success"
            label={`${sentCount?.meta.total ?? 0} Enviados`}
          />
          <Legend
            tone="danger"
            label={`${failedCount?.meta.total ?? 0} Fallidos`}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-surface">
        <table className="w-full">
          <thead className="bg-input">
            <tr>
              <Th>Cliente</Th>
              <Th>Celular</Th>
              <Th>Tipo</Th>
              <Th>Fecha envío</Th>
              <Th>Estado</Th>
              <Th>Preview del mensaje</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <EmptyRow>Cargando…</EmptyRow>}
            {isError && (
              <EmptyRow tone="error">
                No se pudo cargar el historial de mensajes.
              </EmptyRow>
            )}
            {!isLoading && !isError && logs.length === 0 && (
              <EmptyRow>
                {statusFilter === MessageLogStatus.Failed
                  ? 'No hay mensajes fallidos pendientes de revisar.'
                  : 'No se encontraron mensajes.'}
              </EmptyRow>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-border">
                <Td>
                  {log.client.firstName} {log.client.lastName}
                </Td>
                <Td muted>{formatPhoneNumber(log.phoneNumber)}</Td>
                <Td muted>{messageTypeLabel(log.type)}</Td>
                <Td muted>
                  {new Date(log.sentAt).toLocaleString('es-CO', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </Td>
                <Td>
                  <StatusBadge
                    tone={
                      log.status === MessageLogStatus.Sent
                        ? 'success'
                        : 'danger'
                    }
                  >
                    {log.status === MessageLogStatus.Sent
                      ? 'Enviado'
                      : 'Fallido'}
                  </StatusBadge>
                </Td>
                <Td muted className="max-w-[280px] truncate">
                  {log.messageContent}
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <RowActionButton onClick={() => setOpenLog(log)}>
                      Ver completo
                    </RowActionButton>
                    {/* Human report, 2026-09-11 — the status filter can now
                        show a Sent row too (see the comment block above),
                        which the backend's retry endpoint already rejects
                        with a 400 ("Only failed messages can be retried").
                        Gated here so the button doesn't even appear on a
                        row it can't act on. */}
                    {canRetryMessage &&
                      log.status === MessageLogStatus.Failed &&
                      (log.retriedAt ? (
                        <span className="rounded-[3px] border border-border bg-input px-1.75 py-1 text-meta text-subtle">
                          Reintentado
                        </span>
                      ) : (
                        <RowActionButton
                          onClick={() => retryMessageLog.mutate(log.id)}
                          disabled={
                            retryMessageLog.isPending &&
                            retryMessageLog.variables === log.id
                          }
                        >
                          {retryMessageLog.isPending &&
                          retryMessageLog.variables === log.id
                            ? 'Reintentando…'
                            : 'Reintentar'}
                        </RowActionButton>
                      ))}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta && meta.total > 0 && (
        <div className="flex h-8 items-center justify-between">
          <p className="text-label text-muted">
            Mostrando {rowNumberOffset + logs.length} de {meta.total} mensajes
          </p>
          <Pager
            page={page}
            totalPages={meta.totalPages}
            onPageChange={setPage}
          />
        </div>
      )}

      {openLog && (
        <MessageLogDrawer log={openLog} onClose={() => setOpenLog(null)} />
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
        colSpan={7}
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
