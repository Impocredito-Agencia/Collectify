import { useReactivateChannel } from '@/features/channelReminders/useChannelReminders';
import { BrevoChannel } from '@/features/brevo/brevoApi';

interface UndeliverableNoticeProps {
  clientId: string;
  channel: BrevoChannel;
  // Shown inline: "Correo bloqueado", "2 números bloqueados"...
  label: string;
  // Brevo's reason / the numbers, on hover.
  detail: string;
  // SMS only: re-enable just this number (default: every number).
  phoneNumber?: string;
}

// Phase 36, stage 4 — "not contactable" after a definitive Brevo failure
// (email: hard bounce, invalid, blocked, spam, unsubscribed; SMS: hard
// bounce, blacklisted, STOP), with the admin's way to lift it. The email /
// SMS reminders skip it until then; WhatsApp is never affected.
export function UndeliverableNotice({
  clientId,
  channel,
  label,
  detail,
  phoneNumber,
}: UndeliverableNoticeProps) {
  const reactivate = useReactivateChannel();
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-label">
      <span className="text-danger" title={detail}>
        {label}
      </span>
      <button
        type="button"
        disabled={reactivate.isPending}
        onClick={() => reactivate.mutate({ clientId, channel, phoneNumber })}
        className="text-muted underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
      >
        {reactivate.isPending ? 'Reactivando…' : 'Reactivar'}
      </button>
    </span>
  );
}
