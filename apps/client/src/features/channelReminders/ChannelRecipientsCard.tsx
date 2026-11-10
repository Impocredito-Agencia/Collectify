import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { FilterTab } from '@/components/ui/FilterTab';
import { Pager } from '@/components/ui/Pager';
import { Select } from '@/components/ui/Select';
import { Th } from '@/components/ui/Table';
import { ChannelRecipientRow } from '@/features/channelReminders/ChannelRecipientRow';
import { filterRecipients } from '@/features/channelReminders/recipientFilters';
import {
  useChannelRecipients,
  useUpdateChannelRecipients,
} from '@/features/channelReminders/useChannelReminders';
import { ApiError } from '@/lib/apiClient';
import { inputClassName } from '@/lib/formStyles';

import type { ChannelSelectionChange } from '@/features/channelReminders/channelRemindersApi';
import type { RecipientView } from '@/features/channelReminders/recipientFilters';

const PAGE_SIZE = 25;

const MIN_DAYS_OPTIONS = [
  { value: '0', label: 'Cualquier mora' },
  { value: '8', label: 'Más de 7 días' },
  { value: '31', label: 'Más de 30 días' },
  { value: '61', label: 'Más de 60 días' },
  { value: '91', label: 'Más de 90 días' },
];

// Phase 36, stage 3 — who gets the email/SMS reminders, picked by hand
// (confirmed with the human): every client with an overdue cuota, most
// days of mora first, plus anyone who already has a channel on. One switch
// per channel per row, and a bulk action for the checked rows.
export function ChannelRecipientsCard() {
  const { data: recipients, isLoading, isError } = useChannelRecipients();
  const updateMany = useUpdateChannelRecipients();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<RecipientView>('all');
  const [minOverdueDays, setMinOverdueDays] = useState(0);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterRecipients(recipients ?? [], { search, view, minOverdueDays }),
    [recipients, search, view, minOverdueDays],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const allOnPageChecked =
    pageRows.length > 0 && pageRows.every((row) => checked.has(row.clientId));

  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const toggleChecked = (clientId: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });

  const togglePage = () =>
    setChecked((current) => {
      const next = new Set(current);
      for (const row of pageRows) {
        if (allOnPageChecked) {
          next.delete(row.clientId);
        } else {
          next.add(row.clientId);
        }
      }
      return next;
    });

  const applyToChecked = (change: ChannelSelectionChange) => {
    setNotice(null);
    updateMany.mutate(
      { clientIds: [...checked], ...change },
      {
        onSuccess: (result) => {
          setChecked(new Set());
          const skipped = result.skippedWithoutEmail.map((s) => s.fullName);
          setNotice(
            skipped.length > 0
              ? `Listo. Sin correo registrado, no se les activó el correo a: ${skipped.join(', ')}.`
              : `Listo: ${result.updatedClientIds.length} cliente(s) actualizados.`,
          );
        },
        onError: (err) =>
          setNotice(
            err instanceof ApiError
              ? err.message
              : 'No se pudieron actualizar los clientes.',
          ),
      },
    );
  };

  return (
    <div className="flex flex-col gap-3.5 rounded bg-surface p-5">
      <div className="flex flex-col gap-1">
        <span className="text-card-title font-medium text-white">
          Clientes que reciben correo y SMS
        </span>
        <p className="text-label text-muted">
          Clientes con cuotas vencidas, de más a menos días de mora, y los que
          ya tienen algún canal activo. «Con canal activo» muestra solo a
          quienes tienen prendido el correo o el SMS. También se cambia desde la
          ficha de cada cliente.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(event) =>
            changeFilter(() => setSearch(event.target.value))
          }
          placeholder="Buscar por nombre o cédula"
          className={`${inputClassName(false)} max-w-xs`}
        />
        <FilterTab
          label="Todos"
          isActive={view === 'all'}
          onClick={() => changeFilter(() => setView('all'))}
        />
        <FilterTab
          label="Con canal activo"
          isActive={view === 'selected'}
          onClick={() => changeFilter(() => setView('selected'))}
        />
        <Select
          value={String(minOverdueDays)}
          onChange={(value) =>
            changeFilter(() => setMinOverdueDays(Number(value)))
          }
          options={MIN_DAYS_OPTIONS}
          className="w-44"
        />
      </div>

      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.05] px-3.5 py-2">
          <span className="text-small text-white">
            {checked.size} seleccionado(s)
          </span>
          <Button
            variant="secondary"
            disabled={updateMany.isPending}
            onClick={() => applyToChecked({ emailRemindersEnabled: true })}
          >
            Activar correo
          </Button>
          <Button
            variant="secondary"
            disabled={updateMany.isPending}
            onClick={() => applyToChecked({ smsRemindersEnabled: true })}
          >
            Activar SMS
          </Button>
          <Button
            variant="secondary"
            disabled={updateMany.isPending}
            onClick={() =>
              applyToChecked({
                emailRemindersEnabled: false,
                smsRemindersEnabled: false,
              })
            }
          >
            Quitar correo y SMS
          </Button>
        </div>
      )}
      {notice && (
        <p className="text-small text-muted" role="status">
          {notice}
        </p>
      )}

      {isLoading && <p className="text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="text-small text-danger" role="alert">
          No se pudo cargar la lista de clientes.
        </p>
      )}

      {recipients && (
        <div className="overflow-x-auto rounded-lg">
          <table className="w-full">
            <thead className="bg-input">
              <tr>
                <Th className="w-10">
                  <input
                    type="checkbox"
                    checked={allOnPageChecked}
                    onChange={togglePage}
                    aria-label="Seleccionar los clientes de esta página"
                    className="h-3.5 w-3.5 accent-white"
                  />
                </Th>
                <Th>Cliente</Th>
                <Th>Días de mora</Th>
                <Th>Cuotas vencidas</Th>
                <Th>Correo</Th>
                <Th>SMS</Th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((recipient) => (
                <ChannelRecipientRow
                  key={recipient.clientId}
                  recipient={recipient}
                  isChecked={checked.has(recipient.clientId)}
                  onToggleChecked={() => toggleChecked(recipient.clientId)}
                />
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="h-11 px-3.5 text-center text-small text-muted"
                  >
                    No hay clientes que coincidan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <Pager
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
