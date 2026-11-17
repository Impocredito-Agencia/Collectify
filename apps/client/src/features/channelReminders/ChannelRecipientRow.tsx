import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Td } from '@/components/ui/Table';
import { BrevoChannel } from '@/features/brevo/brevoApi';
import { ChannelSwitch } from '@/features/channelReminders/ChannelSwitch';
import { UndeliverableNotice } from '@/features/channelReminders/UndeliverableNotice';
import { useUpdateChannelRecipient } from '@/features/channelReminders/useChannelReminders';
import { ApiError } from '@/lib/apiClient';

import type {
  ChannelRecipient,
  ChannelSelectionChange,
} from '@/features/channelReminders/channelRemindersApi';

interface ChannelRecipientRowProps {
  recipient: ChannelRecipient;
  isChecked: boolean;
  onToggleChecked: () => void;
}

export function ChannelRecipientRow({
  recipient,
  isChecked,
  onToggleChecked,
}: ChannelRecipientRowProps) {
  const updateOne = useUpdateChannelRecipient();
  const [error, setError] = useState<string | null>(null);

  const update = (change: ChannelSelectionChange) => {
    setError(null);
    updateOne.mutate(
      { clientId: recipient.clientId, ...change },
      {
        onError: (err) =>
          setError(
            err instanceof ApiError ? err.message : 'No se pudo guardar.',
          ),
      },
    );
  };

  return (
    <tr className="border-t border-border">
      <Td>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={onToggleChecked}
          aria-label={`Seleccionar a ${recipient.fullName}`}
          className="h-3.5 w-3.5 accent-white"
        />
      </Td>
      <Td>
        <div className="flex flex-col">
          <Link
            to={`/clientes/${recipient.clientId}`}
            className="hover:underline"
          >
            {recipient.fullName}
          </Link>
          <span className="text-label font-normal text-muted">
            CC {recipient.documentNumber}
          </span>
          {error && <span className="text-label text-danger">{error}</span>}
        </div>
      </Td>
      {/* Same bright text as the name (human request, 2026-11-09) — the
          figures the admin picks clients by. */}
      <Td>
        {recipient.maxOverdueDays === null
          ? 'Al día'
          : `${recipient.maxOverdueDays} días`}
      </Td>
      <Td>{recipient.overdueInstallments}</Td>
      <Td muted>
        <ChannelSwitch
          isOn={recipient.emailRemindersEnabled}
          disabled={
            updateOne.isPending ||
            (!recipient.email && !recipient.emailRemindersEnabled)
          }
          title={recipient.email ?? 'Sin correo registrado'}
          label={`Correo para ${recipient.fullName}`}
          onChange={(isOn) => update({ emailRemindersEnabled: isOn })}
        />
        {recipient.emailUndeliverableAt && (
          <UndeliverableNotice
            clientId={recipient.clientId}
            channel={BrevoChannel.Email}
            label="Correo bloqueado"
            detail={recipient.emailUndeliverableReason ?? ''}
          />
        )}
      </Td>
      <Td muted>
        <ChannelSwitch
          isOn={recipient.smsRemindersEnabled}
          disabled={updateOne.isPending}
          title={recipient.phoneNumber}
          label={`SMS para ${recipient.fullName}`}
          onChange={(isOn) => update({ smsRemindersEnabled: isOn })}
        />
        {recipient.smsUndeliverablePhoneNumbers.length > 0 && (
          <UndeliverableNotice
            clientId={recipient.clientId}
            channel={BrevoChannel.Sms}
            label={
              recipient.smsUndeliverablePhoneNumbers.length === 1
                ? '1 número bloqueado'
                : `${recipient.smsUndeliverablePhoneNumbers.length} números bloqueados`
            }
            detail={recipient.smsUndeliverablePhoneNumbers.join(', ')}
          />
        )}
      </Td>
    </tr>
  );
}
