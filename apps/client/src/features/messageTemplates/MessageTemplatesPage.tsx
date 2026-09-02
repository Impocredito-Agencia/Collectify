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
  NEW_LOAN_FAMILY_TYPES,
  REMINDER_FAMILY_TYPES,
} from '@/features/messageTemplates/messageTemplatesApi';
import { useMessageTemplates } from '@/features/messageTemplates/useMessageTemplates';
import {
  useCronStatus,
  usePauseCron,
  useResumeCron,
  useUpdateCronSchedule,
} from '@/features/whatsapp/useWhatsapp';
import { ReminderFamily } from '@/features/whatsapp/whatsappApi';
import { ApiError } from '@/lib/apiClient';

import type {
  Periodicity,
  ScheduleConfig,
} from '@/features/messageTemplates/cronScheduleUtils';
import type { MessageTemplate } from '@/features/messageTemplates/messageTemplatesApi';

// content stays read-only — templates are fixed per message type, editable
// only via a migration, since WhatsApp only lets a business initiate a
// conversation through a Meta-approved template. See docs/DATABASE.md
// "Changed after Phase 9".
//
// Phase 33 replaced the old 4-type catalog (new_loan/upcoming_due/
// overdue/account_summary) with 13 real Meta-approved templates, and
// moved the admin-editable cron schedule (Phase 18) from per-template to
// per-FAMILY — "vencida" now spans 4 templates, "próxima a vencer" spans
// 2, sharing one schedule each (see apps/api/src/whatsapp/reminderFamily.ts).
// A schedule is no longer a property of an individual template card, so
// it's shown once per family above the grid (FamilyCronControl below),
// not embedded in each of the 13 cards. new-loan/refinance and
// payment-confirmation templates have no schedule at all — sent
// synchronously at their triggering event, per
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md's "Technical decisions".
// The curated-audience concept (Phase 18) stays retired, per
// docs/phases/PHASE_27_MESSAGE_FREQUENCY.md.

const FAMILY_LABELS: Record<ReminderFamily, string> = {
  [ReminderFamily.Overdue]: 'Cuotas vencidas',
  [ReminderFamily.UpcomingDue]: 'Cuotas próximas a vencer',
};

// The "schedule owner" row per family — matches
// apps/api/src/whatsapp/whatsappCron.service.ts's SCHEDULE_OWNER exactly.
// PATCH /whatsapp/cron/:family/schedule persists on this template's
// cronExpression; the other templates in the family share it without
// carrying their own.
const FAMILY_SCHEDULE_OWNER: Record<ReminderFamily, MessageType> = {
  [ReminderFamily.Overdue]: MessageType.SingleOverdueInstallment,
  [ReminderFamily.UpcomingDue]: MessageType.SingleUpcomingInstallment,
};

function triggerDescription(type: MessageType): string {
  if (NEW_LOAN_FAMILY_TYPES.includes(type)) {
    return 'Se envía automáticamente, una sola vez, al crear o refinanciar el préstamo — no tiene horario ni reintento programado.';
  }
  if (REMINDER_FAMILY_TYPES.includes(type)) {
    return 'Se envía por el horario automático de su familia de recordatorio (ver arriba). La frecuencia de envío para un cliente puntual se ajusta desde su propio perfil.';
  }
  // PaymentConfirmation / PaidInFull
  return 'Se envía automáticamente al registrar el pago correspondiente — no tiene horario ni reintento programado.';
}

export function MessageTemplatesPage() {
  const { data: templates, isLoading, isError } = useMessageTemplates();

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Plantillas de mensaje"
        subtitle="Solo ADMIN — Contenido fijo, no editable"
      />

      {isLoading && <p className="text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="text-small text-red-400" role="alert">
          No se pudieron cargar las plantillas.
        </p>
      )}

      {!isLoading && !isError && (
        <div className="flex flex-col gap-3.5 rounded bg-surface p-5">
          <span className="text-card-title font-medium text-white">
            Recordatorios automáticos
          </span>
          <div className="grid grid-cols-2 gap-4">
            {Object.values(ReminderFamily).map((family) => (
              <div key={family} className="rounded border border-border p-3.5">
                <span className="mb-2 block text-small font-medium text-white">
                  {FAMILY_LABELS[family]}
                </span>
                <FamilyCronControl
                  family={family}
                  scheduleOwner={templates?.find(
                    (template) =>
                      template.type === FAMILY_SCHEDULE_OWNER[family],
                  )}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLoading && !isError && templates?.length === 0 && (
        <p className="text-small text-muted">Todavía no hay plantillas.</p>
      )}

      <div className="grid grid-cols-2 items-start gap-4">
        {templates?.map((template) => (
          <div
            key={template.id}
            className="flex flex-col gap-3.5 rounded bg-surface p-5"
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
              <p className="text-meta text-muted">
                {triggerDescription(template.type)}
              </p>
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
// Phase 33: parametrized by FAMILY, not template — one schedule now
// covers several templates. `scheduleOwner` is that family's schedule-
// owner row (FAMILY_SCHEDULE_OWNER above), read only for its
// cronExpression seed; undefined while templates are still loading.
function FamilyCronControl({
  family,
  scheduleOwner,
}: {
  family: ReminderFamily;
  scheduleOwner: MessageTemplate | undefined;
}) {
  const { data: cronStatus } = useCronStatus(family);
  const pauseCron = usePauseCron(family);
  const resumeCron = useResumeCron(family);
  const updateSchedule = useUpdateCronSchedule(family);

  const [config, setConfig] = useState<ScheduleConfig>(
    () =>
      parseCronExpression(scheduleOwner?.cronExpression ?? null) ??
      DEFAULT_SCHEDULE_CONFIG,
  );
  const [isDirty, setIsDirty] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Keeps the picker in sync after a successful save (or if another admin
  // changed it) without fighting the admin's own in-progress edits.
  useEffect(() => {
    setConfig(
      parseCronExpression(scheduleOwner?.cronExpression ?? null) ??
        DEFAULT_SCHEDULE_CONFIG,
    );
    setIsDirty(false);
  }, [scheduleOwner?.cronExpression]);

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
              cronStatus?.running ? 'bg-[#22c55e]' : 'bg-[#eab308]'
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
          <span className="text-meta text-[#eab308]">Cambios sin guardar</span>
        )}
      </form>
      {scheduleError && (
        <p className="text-meta text-red-400">{scheduleError}</p>
      )}
    </div>
  );
}

// TemplateAudienceEditor/ClientPickerModal (Phase 18) removed entirely in
// Phase 27 — the overdue/upcoming_due audience concept no longer exists,
// replaced by the per-client frequency whitelist on ClientDetailPage. See
// docs/phasesClient/PHASE_27_MESSAGE_FREQUENCY.md.
