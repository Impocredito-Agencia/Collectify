import { BrevoChannel } from '@/features/brevo/brevoApi';
import { useBrevoStatus } from '@/features/brevo/useBrevo';
import { ChannelReminderFamily } from '@/features/channelReminders/channelRemindersApi';
import {
  useChannelSchedules,
  useRescheduleChannel,
  useSetChannelPaused,
} from '@/features/channelReminders/useChannelReminders';
import { CronScheduleForm } from '@/features/messageTemplates/CronScheduleForm';
import {
  CREDIT_REPORT_FAMILY_TYPES,
  MESSAGE_TYPE_LABELS,
  MessageType,
  OVERDUE_FAMILY_TYPES,
} from '@/features/messageTemplates/messageTemplatesApi';

import type { ChannelSchedule } from '@/features/channelReminders/channelRemindersApi';

// In the order of a loan's life — próximas a vencer → vencidas →
// Datacrédito — the same as the WhatsApp family cards (human request,
// 2026-11-09).
// types: the templates each family sends, listed on its card the same way
// the WhatsApp family cards on Plantillas do (human request, 2026-11-09).
// Upcoming lists only its two own templates, like WhatsApp's card: the
// mixed upcoming+overdue one is sent by the overdue family.
const FAMILIES: {
  family: ChannelReminderFamily;
  label: string;
  description: string;
  types: MessageType[];
}[] = [
  {
    family: ChannelReminderFamily.UpcomingDue,
    label: 'Cuotas próximas a vencer',
    description:
      'A los clientes marcados con cuotas por vencer y ninguna vencida (esos ya reciben el de vencidas).',
    types: [
      MessageType.SingleUpcomingInstallment,
      MessageType.MultipleUpcomingInstallments,
    ],
  },
  {
    family: ChannelReminderFamily.Overdue,
    label: 'Cuotas vencidas',
    description:
      'A los clientes marcados que tengan cuotas vencidas. Mismo texto y valores que el recordatorio de WhatsApp.',
    types: OVERDUE_FAMILY_TYPES,
  },
  {
    family: ChannelReminderFamily.CreditReport,
    label: 'Reporte a Datacrédito',
    description:
      'Aviso del día 30 y del día 50 de mora. Debe correr todos los días: un día sin envío no se recupera.',
    types: CREDIT_REPORT_FAMILY_TYPES,
  },
];

const CHANNELS: { channel: BrevoChannel; label: string }[] = [
  { channel: BrevoChannel.Email, label: 'Correo' },
  { channel: BrevoChannel.Sms, label: 'SMS' },
];

// Phase 36, stage 3 — when the email and SMS reminders run: per family and
// per channel, each with its own on/off and schedule, independent of the
// WhatsApp schedule of the same family. All start paused.
export function ChannelSchedulesCard() {
  const { data: schedules, isLoading, isError } = useChannelSchedules();
  const { data: brevoStatus } = useBrevoStatus();

  const find = (family: ChannelReminderFamily, channel: BrevoChannel) =>
    schedules?.find(
      (schedule) => schedule.family === family && schedule.channel === channel,
    );
  const serverPaused: Record<BrevoChannel, boolean> = {
    [BrevoChannel.Email]: Boolean(brevoStatus?.email.sendingPaused),
    [BrevoChannel.Sms]: Boolean(brevoStatus?.sms.sendingPaused),
  };

  return (
    <div className="flex flex-col gap-3.5 rounded bg-surface p-5">
      <div className="flex flex-col gap-1">
        <span className="text-card-title font-medium text-white">
          Envíos automáticos por correo y SMS
        </span>
        <p className="text-label text-muted">
          Solo llegan a los clientes marcados abajo, además del WhatsApp. El
          mínimo de días entre mensajes de cada cliente no aplica aquí.
        </p>
      </div>

      {isLoading && <p className="text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="text-small text-danger" role="alert">
          No se pudieron cargar los horarios.
        </p>
      )}

      {schedules && (
        <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-3">
          {FAMILIES.map(({ family, label, description, types }) => (
            <div
              key={family}
              className="flex flex-col gap-3 rounded-lg bg-white/[0.03] p-4"
            >
              <div className="flex flex-col gap-1">
                <span className="text-small font-medium text-white">
                  {label}
                </span>
                <span className="text-label text-muted">{description}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {types.map((type) => (
                  <span
                    key={type}
                    className="rounded-[3px] border border-border bg-input px-2 py-[3px] text-label font-medium text-muted"
                  >
                    {MESSAGE_TYPE_LABELS[type]}
                  </span>
                ))}
              </div>
              {/* mt-auto — cards list a different number of templates; this
                  keeps the Correo/SMS rows lined up across the three cards,
                  same as the WhatsApp family cards. */}
              <div className="mt-auto flex flex-col gap-3">
                {CHANNELS.map(({ channel, label: channelLabel }) => {
                  const schedule = find(family, channel);
                  return schedule ? (
                    <ChannelScheduleControl
                      key={channel}
                      schedule={schedule}
                      label={channelLabel}
                      isServerPaused={serverPaused[channel]}
                    />
                  ) : null;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ChannelScheduleControlProps {
  schedule: ChannelSchedule;
  label: string;
  isServerPaused: boolean;
}

function ChannelScheduleControl({
  schedule,
  label,
  isServerPaused,
}: ChannelScheduleControlProps) {
  const reschedule = useRescheduleChannel();
  const setPaused = useSetChannelPaused();
  const { family, channel, isPaused } = schedule;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`size-1.5 shrink-0 rounded-full ${isPaused ? 'bg-warning' : 'bg-success'}`}
          />
          <span className="text-label text-white">{label}</span>
          <span className="text-label text-muted">
            — {isPaused ? 'Pausado' : 'Activo'}
          </span>
        </div>
        <button
          type="button"
          onClick={() =>
            setPaused.mutate({ family, channel, isPaused: !isPaused })
          }
          disabled={setPaused.isPending}
          className="text-label text-muted underline-offset-2 hover:text-white hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPaused ? 'Activar' : 'Pausar'}
        </button>
      </div>
      {!isPaused && isServerPaused && (
        <span className="text-label text-warning">
          Activo aquí, pero el envío de {label.toLowerCase()} está en pausa en
          el servidor: no saldrá nada salvo a la lista de prueba.
        </span>
      )}
      {!isPaused && channel === BrevoChannel.Sms && !isServerPaused && (
        <span className="text-label text-warning">
          Cada SMS consume créditos de Brevo.
        </span>
      )}
      <CronScheduleForm
        cronExpression={schedule.cronExpression}
        onSave={(cronExpression) =>
          reschedule.mutateAsync({ family, channel, cronExpression })
        }
        isSaving={reschedule.isPending}
        tone="blue"
        textSize="label"
      />
    </div>
  );
}
