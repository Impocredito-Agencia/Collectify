import { useEffect, useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import {
  buildCronExpression,
  DEFAULT_SCHEDULE_CONFIG,
  parseCronExpression,
} from '@/features/messageTemplates/cronScheduleUtils';
import {
  MESSAGE_TYPE_LABELS,
  MessageType,
  NEW_LOAN_FAMILY_TYPES,
  OVERDUE_FAMILY_TYPES,
  REMINDER_FAMILY_TYPES,
  UPCOMING_FAMILY_TYPES,
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

import type { ScheduleConfig } from '@/features/messageTemplates/cronScheduleUtils';
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
// not embedded in each of the 13 cards. Payment-confirmation/paid-in-full
// templates are the only ones left with no schedule — sent synchronously
// at their triggering event. new-loan/refinance moved back into the
// scheduled group 2026-09-09 (confirmed with the human) — see
// reminderFamily.ts's own comment for why.
// The curated-audience concept (Phase 18) stays retired, per
// docs/phases/PHASE_27_MESSAGE_FREQUENCY.md.

const FAMILY_LABELS: Record<ReminderFamily, string> = {
  [ReminderFamily.Overdue]: 'Cuotas vencidas',
  [ReminderFamily.UpcomingDue]: 'Cuotas próximas a vencer',
  [ReminderFamily.NewLoan]: 'Nuevo pagaré / Refinanciación',
};

// The "schedule owner" row per family — matches
// apps/api/src/whatsapp/whatsappCron.service.ts's SCHEDULE_OWNER exactly.
// PATCH /whatsapp/cron/:family/schedule persists on this template's
// cronExpression; the other templates in the family share it without
// carrying their own.
const FAMILY_SCHEDULE_OWNER: Record<ReminderFamily, MessageType> = {
  [ReminderFamily.Overdue]: MessageType.SingleOverdueInstallment,
  [ReminderFamily.UpcomingDue]: MessageType.SingleUpcomingInstallment,
  [ReminderFamily.NewLoan]: NEW_LOAN_FAMILY_TYPES[0],
};

// Added 2026-09-06 (human request) — every template that shares a
// family's schedule, listed on that family's own card so it's clear at a
// glance what a pause/reschedule actually affects, without having to
// cross-reference the grid of 13 cards below.
//
// Human report, 2026-09-11 — UpcomingAndOverdueMixed is filtered out of
// UpcomingDue's list here, even though it's a real member of
// UPCOMING_FAMILY_TYPES (kept there as-is for the message-frequency
// throttle — see reminderFamily.ts). Showing it on both cards implied
// pausing "Cuotas próximas a vencer" also stops the combined message,
// which isn't true: the daily upcoming_due cron excludes any client who
// also has an overdue installment, so it never actually selects this
// template for an automated send — the weekly overdue cron owns that
// case exclusively (OverdueReminderService, reversed 2026-09-07). This is
// a display-only fix — UPCOMING_FAMILY_TYPES itself is untouched.
const FAMILY_TYPES: Record<ReminderFamily, MessageType[]> = {
  [ReminderFamily.Overdue]: OVERDUE_FAMILY_TYPES,
  [ReminderFamily.UpcomingDue]: UPCOMING_FAMILY_TYPES.filter(
    (type) => type !== MessageType.UpcomingAndOverdueMixed,
  ),
  [ReminderFamily.NewLoan]: NEW_LOAN_FAMILY_TYPES,
};

function triggerDescription(type: MessageType): string {
  if (NEW_LOAN_FAMILY_TYPES.includes(type)) {
    return 'Se envía por el horario automático de su familia (ver arriba) — solo para préstamos marcados como "nuevo" al crearlos. Un préstamo histórico/cargado después no lo dispara.';
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
        <p className="text-small text-danger" role="alert">
          No se pudieron cargar las plantillas.
        </p>
      )}

      {!isLoading && !isError && (
        <div className="flex flex-col gap-3.5 rounded bg-surface p-5">
          <span className="text-card-title font-medium text-white">
            Recordatorios automáticos
          </span>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Object.values(ReminderFamily).map((family) => (
              <div key={family} className="rounded border border-border p-3.5">
                <span className="mb-2 block text-small font-medium text-white">
                  {FAMILY_LABELS[family]}
                </span>
                <FamilyCronControl
                  family={family}
                  types={FAMILY_TYPES[family]}
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

const DAY_OF_WEEK_OPTIONS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// A friendly day-of-week+time picker instead of a raw cron expression
// (added after client QA, 2026-08-18 — see docs/phasesClient/PHASE_18_MESSAGE_AUDIENCES.md).
// Phase 33: parametrized by FAMILY, not template — one schedule now
// covers several templates. `scheduleOwner` is that family's schedule-
// owner row (FAMILY_SCHEDULE_OWNER above), read only for its
// cronExpression seed; undefined while templates are still loading.
//
// Simplified 2026-09-05 (human request): dropped the periodicity picker
// (cada día/semana/15 días/mes) — every schedule is always weekly, with
// the admin toggling which day(s) of the week it fires on instead.
function FamilyCronControl({
  family,
  types,
  scheduleOwner,
}: {
  family: ReminderFamily;
  types: MessageType[];
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

  const toggleDayOfWeek = (day: number) => {
    updateConfig({
      daysOfWeek: config.daysOfWeek.includes(day)
        ? config.daysOfWeek.filter((d) => d !== day)
        : [...config.daysOfWeek, day],
    });
  };

  const isTogglePending = pauseCron.isPending || resumeCron.isPending;
  const hasNoDaysSelected = config.daysOfWeek.length === 0;

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
          <Button
            variant="secondary"
            onClick={() =>
              cronStatus.running ? pauseCron.mutate() : resumeCron.mutate()
            }
            disabled={isTogglePending}
          >
            {cronStatus.running ? 'Pausar' : 'Reanudar'}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {types.map((type) => (
          <span
            key={type}
            className="rounded-[3px] border border-border bg-input px-2 py-[3px] text-meta font-medium text-muted"
          >
            {MESSAGE_TYPE_LABELS[type]}
          </span>
        ))}
      </div>

      <form onSubmit={handleSaveSchedule} className="flex flex-col gap-2">
        <span className="text-meta text-muted">Recordatorios semanales</span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {DAY_OF_WEEK_OPTIONS.map((option) => {
              const isSelected = config.daysOfWeek.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleDayOfWeek(option.value)}
                  className={`h-9 rounded border px-2.5 text-meta ${
                    isSelected
                      ? 'border-accent bg-accent text-white'
                      : 'border-border bg-input text-muted hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <input
            type="time"
            value={`${pad2(config.hour)}:${pad2(config.minute)}`}
            onChange={(event) => {
              const [hour, minute] = event.target.value.split(':').map(Number);
              updateConfig({ hour, minute });
            }}
            className="h-9 rounded border border-border bg-input px-2 text-meta text-white focus:outline-none"
          />

          <Button
            type="submit"
            variant="secondary"
            disabled={!isDirty || hasNoDaysSelected || updateSchedule.isPending}
            className="shrink-0"
          >
            {updateSchedule.isPending ? 'Guardando…' : 'Guardar horario'}
          </Button>
        </div>
        {hasNoDaysSelected && (
          <span className="text-meta text-danger">
            Seleccione al menos un día.
          </span>
        )}
        {!hasNoDaysSelected && isDirty && (
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
