import { useState } from 'react';
import { Link } from 'react-router-dom';

import { BrevoChannel } from '@/features/brevo/brevoApi';
import { ChannelSwitch } from '@/features/channelReminders/ChannelSwitch';
import { UndeliverableNotice } from '@/features/channelReminders/UndeliverableNotice';
import { useUpdateChannelRecipient } from '@/features/channelReminders/useChannelReminders';
import { ApiError } from '@/lib/apiClient';
import { formatPhoneNumber } from '@/lib/format';

import type { ChannelSelectionChange } from '@/features/channelReminders/channelRemindersApi';
import type { ClientDetail } from '@/features/clients/clientsApi';

interface ClientReminderChannelsSectionProps {
  client: Pick<
    ClientDetail,
    | 'id'
    | 'email'
    | 'phoneNumber'
    | 'emailRemindersEnabled'
    | 'smsRemindersEnabled'
    | 'emailUndeliverableAt'
    | 'emailUndeliverableReason'
    | 'smsUndeliverablePhoneNumbers'
  >;
}

// Phase 36, stage 3 — the client's own two switches for the scheduled email
// and SMS reminders (also editable in bulk from Plantillas → Correo y SMS).
// Shown only to users with the message_templates module, the same gate as
// the endpoint behind it.
export function ClientReminderChannelsSection({
  client,
}: ClientReminderChannelsSectionProps) {
  const updateOne = useUpdateChannelRecipient();
  const [error, setError] = useState<string | null>(null);
  const hasEmail = Boolean(client.email?.trim());

  const update = (change: ChannelSelectionChange) => {
    setError(null);
    updateOne.mutate(
      { clientId: client.id, ...change },
      {
        onError: (err) =>
          setError(
            err instanceof ApiError ? err.message : 'No se pudo guardar.',
          ),
      },
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface p-4">
      <div className="flex flex-col gap-1">
        <span className="text-label font-medium text-white">
          Recordatorios por correo y SMS
        </span>
        <span className="text-meta text-muted">
          Además del WhatsApp, según los horarios de{' '}
          <Link to="/plantillas/correo-sms" className="underline">
            Plantillas → Correo y SMS
          </Link>
          .
        </span>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <label className="flex items-center gap-2.5 text-small text-white">
          <ChannelSwitch
            isOn={client.emailRemindersEnabled}
            disabled={
              updateOne.isPending ||
              (!hasEmail && !client.emailRemindersEnabled)
            }
            title={client.email ?? 'Sin correo registrado'}
            label="Recordatorios por correo"
            onChange={(isOn) => update({ emailRemindersEnabled: isOn })}
          />
          Correo
          <span className="text-meta text-muted">
            {hasEmail ? client.email : 'sin correo registrado'}
          </span>
        </label>
        <label className="flex items-center gap-2.5 text-small text-white">
          <ChannelSwitch
            isOn={client.smsRemindersEnabled}
            disabled={updateOne.isPending}
            title="A los mismos números que el WhatsApp"
            label="Recordatorios por SMS"
            onChange={(isOn) => update({ smsRemindersEnabled: isOn })}
          />
          SMS
          <span className="text-meta text-muted">
            a los mismos números que el WhatsApp
          </span>
        </label>
      </div>
      {client.emailUndeliverableAt && (
        <div className="flex flex-col gap-0.5">
          <span className="text-label text-muted">
            No se le envían correos: Brevo informó{' '}
            {client.emailUndeliverableReason ?? 'un fallo definitivo'}. Corrige
            el correo en la ficha (se reactiva solo) o reactívalo si ya se
            resolvió.
          </span>
          <UndeliverableNotice
            clientId={client.id}
            channel={BrevoChannel.Email}
            label="Correo bloqueado"
            detail={client.emailUndeliverableReason ?? ''}
          />
        </div>
      )}
      {client.smsUndeliverablePhoneNumbers.map((phoneNumber) => (
        <UndeliverableNotice
          key={phoneNumber}
          clientId={client.id}
          channel={BrevoChannel.Sms}
          label={`SMS bloqueado al ${formatPhoneNumber(phoneNumber)} (rebotó o respondió STOP)`}
          detail={phoneNumber}
          phoneNumber={phoneNumber}
        />
      ))}
      {error && (
        <p className="text-small text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
