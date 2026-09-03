import { useEffect, useState } from 'react';

import { Header } from '@/components/layout/Header';
import {
  buildCronExpression,
  DEFAULT_SCHEDULE_CONFIG,
  parseCronExpression,
} from '@/features/messageTemplates/cronScheduleUtils';
import {
  MESSAGE_TYPE_LABELS,
  MessageType,
} from '@/features/messageTemplates/messageTemplatesApi';
import { useMessageTemplates } from '@/features/messageTemplates/useMessageTemplates';
import {
  useCronStatus,
  usePauseCron,
  useResumeCron,
  useUpdateCronSchedule,
} from '@/features/whatsapp/useWhatsapp';
import { ApiError } from '@/lib/apiClient';

import type {
  Periodicity,
  ScheduleConfig,
} from '@/features/messageTemplates/cronScheduleUtils';
import type { MessageTemplate } from '@/features/messageTemplates/messageTemplatesApi';

// content stays read-only after the backend refactor (main, PR #16 on the
// backend side) — templates are fixed per message type, editable only via
// a migration, since WhatsApp only lets a business initiate a conversation
// through a Meta-approved template. See docs/DATABASE.md "Changed after
// Phase 9".
//
// Phase 18 added an admin-editable cron schedule per template — kept.
// It also added a curated audience (group of clients) per template,
// **retired as of Phase 27** (see docs/phases/PHASE_27_MESSAGE_FREQUENCY.md):
//   - new_loan has NO schedule at all — it's sent exactly once,
//     synchronously, at loan creation.
//   - account_summary has NO audience — it's sent automatically to every
//     client with an active loan, but keeps its schedule.
//   - overdue/upcoming_due keep their schedule; the audience-as-required-
//     filter design is gone (every dynamically-qualifying client is
//     messaged again), replaced by a per-client frequency whitelist
//     managed from that client's own profile, not from here.
// Grid pairing, distinct from MESSAGE_TYPE_ORDER (used elsewhere for
// filter dropdowns etc.) — new_loan is the only short card now (no
// schedule at all); the other three are the same height (schedule only).
const GRID_DISPLAY_ORDER: MessageType[] = [
  MessageType.NewLoan,
  MessageType.AccountSummary,
  MessageType.UpcomingDue,
  MessageType.Overdue,
];

export function MessageTemplatesPage() {
  const { data: templates, isLoading, isError } = useMessageTemplates();
  const orderedTemplates = templates
    ? [...templates].sort(
        (a, b) =>
          GRID_DISPLAY_ORDER.indexOf(a.type) -
          GRID_DISPLAY_ORDER.indexOf(b.type),
      )
    : templates;

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Plantillas de mensaje"
        subtitle="Solo ADMIN — Contenido fijo, no editable"
      />

      {isLoading && <p className="text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="text-small text-danger" role="alert">
          No se pudieron cargar las plantillas.
        </p>
      )}
      {!isLoading && !isError && templates?.length === 0 && (
        <p className="text-small text-muted">Todavía no hay plantillas.</p>
      )}

      <div className="grid grid-cols-2 items-start gap-4">
        {orderedTemplates?.map((template) => (
          <div
            key={template.id}
            className="flex flex-col gap-3.5 rounded-lg bg-surface p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-card-title font-medium text-white">
                {template.name}
              </span>
              <span className="rounded-[3px] border border-border bg-input px-2 py-[3px] text-meta font-medium text-muted">
                {MESSAGE_TYPE_LABELS[template.type]}
              </span>
            </div>
            <p className="whitespace-pre-line text-small text-muted">
              {template.content}
            </p>

            <div className="border-t border-border pt-3">
              {template.type === MessageType.NewLoan ? (
                <p className="text-meta text-muted">
                  Se envía automáticamente, una sola vez, al crear el préstamo —
                  no tiene horario ni reintento programado.
                </p>
              ) : (
                <TemplateCronControl template={template} />
              )}
            </div>

            <div className="border-t border-border pt-3">
              {template.type === MessageType.NewLoan ? (
                <p className="text-meta text-muted">
                  No usa grupo de destinatarios.
                </p>
              ) : template.type === MessageType.AccountSummary ? (
                <p className="text-meta text-muted">
                  Sin grupo — le llega automáticamente a todos los clientes con
                  crédito activo.
                </p>
              ) : (
                <p className="text-meta text-muted">
                  Sin grupo — le llega a todos los clientes que califiquen (mora
                  o cuota por vencer). La frecuencia de envío para un cliente
                  puntual se ajusta desde su propio perfil.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const PERIODICITY_OPTIONS: { value: Periodicity; label: string }[] = [
  { value: 'daily', label: 'Cada día' },
  { value: 'weekly', label: 'Cada semana' },
  { value: 'biweekly', label: 'Cada 15 días' },
  { value: 'monthly', label: 'Cada mes' },
];

const DAY_OF_WEEK_OPTIONS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
];

const DAY_OF_MONTH_OPTIONS = Array.from(
  { length: 28 },
  (_, index) => index + 1,
);

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// A friendly periodicity+time picker instead of a raw cron expression
// (added after client QA, 2026-08-18 — see docs/phasesClient/PHASE_18_MESSAGE_AUDIENCES.md).
// Not offered for new_loan, which has no schedule at all — see the parent
// component.
function TemplateCronControl({ template }: { template: MessageTemplate }) {
  const { data: cronStatus } = useCronStatus(template.type);
  const pauseCron = usePauseCron(template.type);
  const resumeCron = useResumeCron(template.type);
  const updateSchedule = useUpdateCronSchedule(template.type);

  const [config, setConfig] = useState<ScheduleConfig>(
    () =>
      parseCronExpression(template.cronExpression) ?? DEFAULT_SCHEDULE_CONFIG,
  );
  const [isDirty, setIsDirty] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Keeps the picker in sync after a successful save (or if another admin
  // changed it) without fighting the admin's own in-progress edits.
  useEffect(() => {
    setConfig(
      parseCronExpression(template.cronExpression) ?? DEFAULT_SCHEDULE_CONFIG,
    );
    setIsDirty(false);
  }, [template.cronExpression]);

  const updateConfig = (changes: Partial<ScheduleConfig>) => {
    setConfig((prev) => ({ ...prev, ...changes }));
    setIsDirty(true);
  };

  const isTogglePending = pauseCron.isPending || resumeCron.isPending;

  const handleSaveSchedule = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setScheduleError(null);
    try {
      await updateSchedule.mutateAsync(buildCronExpression(config));
      setIsDirty(false);
    } catch (error) {
      setScheduleError(
        error instanceof ApiError
          ? error.message
          : 'No se pudo actualizar el horario.',
      );
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 shrink-0 rounded-full ${
              cronStatus?.running ? 'bg-success' : 'bg-warning'
            }`}
          />
          <span className="text-small font-medium text-white">
            Envío automático —{' '}
            {cronStatus ? (cronStatus.running ? 'Activo' : 'Pausado') : '—'}
          </span>
        </div>
        {cronStatus && (
          <button
            type="button"
            onClick={() =>
              cronStatus.running ? pauseCron.mutate() : resumeCron.mutate()
            }
            disabled={isTogglePending}
            className="rounded border border-border bg-input px-3 py-1.5 text-meta text-muted hover:text-white disabled:opacity-50"
          >
            {cronStatus.running ? 'Pausar' : 'Reanudar'}
          </button>
        )}
      </div>

      <form onSubmit={handleSaveSchedule} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={config.periodicity}
            onChange={(event) =>
              updateConfig({ periodicity: event.target.value as Periodicity })
            }
            className="h-9 rounded border border-border bg-input px-2 text-meta text-white focus:outline-none"
          >
            {PERIODICITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {config.periodicity === 'weekly' && (
            <select
              value={config.dayOfWeek}
              onChange={(event) =>
                updateConfig({ dayOfWeek: Number(event.target.value) })
              }
              className="h-9 rounded border border-border bg-input px-2 text-meta text-white focus:outline-none"
            >
              {DAY_OF_WEEK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          {config.periodicity === 'monthly' && (
            <select
              value={config.dayOfMonth}
              onChange={(event) =>
                updateConfig({ dayOfMonth: Number(event.target.value) })
              }
              className="h-9 rounded border border-border bg-input px-2 text-meta text-white focus:outline-none"
            >
              {DAY_OF_MONTH_OPTIONS.map((day) => (
                <option key={day} value={day}>
                  Día {day}
                </option>
              ))}
            </select>
          )}

          <input
            type="time"
            value={`${pad2(config.hour)}:${pad2(config.minute)}`}
            onChange={(event) => {
              const [hour, minute] = event.target.value.split(':').map(Number);
              updateConfig({ hour, minute });
            }}
            className="h-9 rounded border border-border bg-input px-2 text-meta text-white focus:outline-none"
          />

          <button
            type="submit"
            disabled={!isDirty || updateSchedule.isPending}
            className="shrink-0 rounded border border-border bg-input px-3 py-1.5 text-meta text-muted hover:text-white disabled:opacity-50"
          >
            {updateSchedule.isPending ? 'Guardando…' : 'Guardar horario'}
          </button>
        </div>
        {isDirty && (
          <span className="text-meta text-warning">Cambios sin guardar</span>
        )}
      </form>
      {scheduleError && (
        <p className="text-meta text-danger">{scheduleError}</p>
      )}
    </div>
  );
}

// TemplateAudienceEditor/ClientPickerModal (Phase 18) removed entirely in
// Phase 27 — the overdue/upcoming_due audience concept no longer exists,
// replaced by the per-client frequency whitelist on ClientDetailPage. See
// docs/phasesClient/PHASE_27_MESSAGE_FREQUENCY.md.
