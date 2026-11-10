import { useLocation, useNavigate } from 'react-router-dom';

import { Header } from '@/components/layout/Header';
import { MailIcon } from '@/components/ui/MailIcon';
import { WhatsappIcon } from '@/components/ui/WhatsappIcon';
import { BankAccountCard } from '@/features/bankAccount/BankAccountCard';
import { EmailSmsPanel } from '@/features/channelTemplates/EmailSmsPanel';
import { ChannelTab } from '@/features/messageTemplates/ChannelTab';
import { CronScheduleForm } from '@/features/messageTemplates/CronScheduleForm';
import {
  MESSAGE_TYPE_LABELS,
  MESSAGE_TYPE_ORDER,
  MessageType,
  NEW_LOAN_FAMILY_TYPES,
  CREDIT_REPORT_FAMILY_TYPES,
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

// In the order of a loan's life (human request, 2026-11-09): new pagaré →
// próximas a vencer → vencidas → Datacrédito; the template cards below
// follow MESSAGE_TYPE_ORDER, the same order, with the payment
// confirmations last. The Correo y SMS tab uses it too, minus new pagaré.
const FAMILY_ORDER: ReminderFamily[] = [
  ReminderFamily.NewLoan,
  ReminderFamily.UpcomingDue,
  ReminderFamily.Overdue,
  ReminderFamily.CreditReport,
];

const FAMILY_LABELS: Record<ReminderFamily, string> = {
  [ReminderFamily.Overdue]: 'Cuotas vencidas',
  [ReminderFamily.UpcomingDue]: 'Cuotas próximas a vencer',
  [ReminderFamily.NewLoan]: 'Nuevo pagaré / Refinanciación',
  [ReminderFamily.CreditReport]: 'Reporte a Datacrédito',
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
  [ReminderFamily.CreditReport]: CREDIT_REPORT_FAMILY_TYPES[0],
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
    (type) =>
      type !== MessageType.UpcomingAndOverdueMixed &&
      type !== MessageType.UpcomingAndOverdueMixedOver30Days,
  ),
  [ReminderFamily.NewLoan]: NEW_LOAN_FAMILY_TYPES,
  [ReminderFamily.CreditReport]: CREDIT_REPORT_FAMILY_TYPES,
};

function triggerDescription(type: MessageType): string {
  if (NEW_LOAN_FAMILY_TYPES.includes(type)) {
    return 'Se envía por el horario automático de su familia (ver arriba) — solo para préstamos marcados como "nuevo" al crearlos. Un préstamo histórico/cargado después no lo dispara.';
  }
  if (CREDIT_REPORT_FAMILY_TYPES.includes(type)) {
    return 'Se envía una sola vez, el día exacto en que el pagaré cumple esos días de mora según su cuota vencida más antigua. El horario debe incluir todos los días: un día sin envío no se recupera después.';
  }
  if (REMINDER_FAMILY_TYPES.includes(type)) {
    return 'Se envía por el horario automático de su familia de recordatorio (ver arriba). La frecuencia de envío para un cliente puntual se ajusta desde su propio perfil.';
  }
  // PaymentConfirmation / PaidInFull
  return 'Se envía automáticamente al registrar el pago correspondiente — no tiene horario ni reintento programado.';
}

const TEMPLATES_PATH = '/plantillas';
const EMAIL_SMS_PATH = '/plantillas/correo-sms';

export function MessageTemplatesPage() {
  const { data: templates, isLoading, isError } = useMessageTemplates();
  const sortedTemplates = [...(templates ?? [])].sort(
    (a, b) =>
      MESSAGE_TYPE_ORDER.indexOf(a.type) - MESSAGE_TYPE_ORDER.indexOf(b.type),
  );
  const navigate = useNavigate();
  // Phase 36 — "WhatsApp" | "Correo y SMS" tabs, the same pattern as
  // Préstamos' "Préstamos" | "Eliminados" (human request, 2026-11-09):
  // replaced a button to a separate sub-page. The tab lives in the URL
  // (/plantillas vs /plantillas/correo-sms) rather than session state like
  // Préstamos does, so the client profile can link straight to Correo y
  // SMS and the browser's back button switches tabs too.
  const isEmailSms = useLocation().pathname.startsWith(EMAIL_SMS_PATH);

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Plantillas de mensaje"
        subtitle={
          isEmailSms
            ? 'Solo ADMIN — Envíos por Brevo; textos editables'
            : 'Solo ADMIN — Contenido fijo; solo la cuenta bancaria es editable'
        }
      />

      <div className="border-t border-border" />

      <div className="flex items-center gap-2">
        <ChannelTab
          label="WhatsApp"
          icon={<WhatsappIcon />}
          tone="green"
          isActive={!isEmailSms}
          onClick={() => navigate(TEMPLATES_PATH)}
        />
        <ChannelTab
          label="Correo y SMS"
          icon={<MailIcon />}
          tone="blue"
          isActive={isEmailSms}
          onClick={() => navigate(EMAIL_SMS_PATH)}
        />
      </div>

      {isEmailSms ? (
        <EmailSmsPanel />
      ) : (
        <>
          <BankAccountCard />

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
              {/* Human report, 2026-09-14 — the cards look uneven in height
                since each family lists a different number of template
                badges, wrapping into a different number of rows.
                items-stretch (grid's own default, made explicit) forces all
                of them to match the tallest row's height; h-full + flex flex-col
                on the card itself, plus FamilyCronControl's own flex-1 +
                mt-auto on its schedule form below, pin "Recordatorios
                semanales"/"Guardar horario" to the same bottom edge across
                all of them regardless of how many badge rows sit above it — not
                just equal height, but genuinely aligned. */}
              <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
                {FAMILY_ORDER.map((family) => (
                  <div
                    key={family}
                    className="flex h-full flex-col gap-3 rounded border border-border p-3.5"
                  >
                    {/* Human report, 2026-09-14 — this used to be text-small,
                      the exact same size/weight as "Envío automático" one
                      level below it inside FamilyCronControl, so the two
                      read as peers instead of title→status. text-card-title
                      is the same token "Recordatorios automáticos" (the
                      section title above this grid) and each template
                      card's own name already use — this card's title now
                      unambiguously outranks everything inside it. */}
                    <span className="text-card-title font-medium text-white">
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

          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
            {sortedTemplates.map((template) => (
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
        </>
      )}
    </div>
  );
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

  const isTogglePending = pauseCron.isPending || resumeCron.isPending;

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* Human report, 2026-09-14 — status/Pausar demoted from a
          full-size Button + text-small row (the same weight as the card
          title above) down to text-meta + a plain text toggle. This is
          metadata about the card, not a second heading competing with
          it, and Pausar is an occasional toggle, not the card's main
          action — it shouldn't outweigh "Guardar horario" below. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              cronStatus?.running ? 'bg-success' : 'bg-warning'
            }`}
          />
          <span className="text-meta text-muted">
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
            className="text-meta text-muted underline-offset-2 hover:text-white hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cronStatus.running ? 'Pausar' : 'Reanudar'}
          </button>
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

      {/* border-t (human report, 2026-09-14) — separates "what this
          family does + its current status" above from "when it fires"
          below. The picker itself is shared with the email/SMS schedules
          (CronScheduleForm, Phase 36). */}
      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        <span className="text-meta text-muted">Recordatorios semanales</span>
        <CronScheduleForm
          cronExpression={scheduleOwner?.cronExpression ?? null}
          onSave={(cronExpression) =>
            updateSchedule.mutateAsync(cronExpression)
          }
          isSaving={updateSchedule.isPending}
        />
      </div>
    </div>
  );
}
