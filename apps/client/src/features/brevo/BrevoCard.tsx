import { StatusBadge } from '@/components/ui/StatusBadge';
import { BrevoChannel } from '@/features/brevo/brevoApi';
import {
  describeChannelState,
  describeSendFailure,
  formatPlanType,
} from '@/features/brevo/brevoLabels';
import { BrevoTestSendForm } from '@/features/brevo/BrevoTestSendForm';
import { useBrevoStatus } from '@/features/brevo/useBrevo';

import type {
  BrevoAccountInfo,
  BrevoChannelStatus,
} from '@/features/brevo/brevoApi';

// Phase 36, stage 1 — whether email and SMS through Brevo are ready, the
// account's credits, and a fixed test send. Everything comes from
// GET /brevo/status; configuration itself lives in the server's env vars,
// never in the browser. See docs/phasesClient/PHASE_36_BREVO_EMAIL_SMS.md.
export function BrevoCard() {
  const { data: status, isLoading, isError } = useBrevoStatus();

  return (
    <div className="flex flex-col gap-3.5 rounded bg-surface p-5">
      <div className="flex flex-col gap-1">
        <span className="text-card-title font-medium text-white">
          Correo y SMS (Brevo)
        </span>
        <p className="text-small text-muted">
          Canales de envío adicionales a WhatsApp. Por ahora solo se usan para
          el envío de prueba; los recordatorios siguen saliendo solo por
          WhatsApp.
        </p>
      </div>

      {isLoading && <p className="text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="text-small text-danger" role="alert">
          No se pudo cargar el estado de Brevo.
        </p>
      )}

      {status && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ChannelRow
              channel={BrevoChannel.Email}
              title="Correo"
              status={status.email}
            />
            <ChannelRow
              channel={BrevoChannel.Sms}
              title="SMS"
              status={status.sms}
            />
          </div>

          <AccountRow account={status.account} />

          {status.testRecipientsCount > 0 && (
            <p className="text-meta text-muted">
              Lista de prueba: {status.testRecipientsCount}{' '}
              {status.testRecipientsCount === 1
                ? 'destinatario recibe'
                : 'destinatarios reciben'}{' '}
              envíos aunque el canal esté en pausa.
            </p>
          )}

          <BrevoTestSendForm />
        </>
      )}
    </div>
  );
}

interface ChannelRowProps {
  channel: BrevoChannel;
  title: string;
  status: BrevoChannelStatus;
}

function ChannelRow({ channel, title, status }: ChannelRowProps) {
  const state = describeChannelState(channel, status);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-white/[0.03] px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-small font-medium text-white">{title}</span>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      </div>
      <span className="text-meta text-muted">{state.description}</span>
      {status.sender && (
        <span className="text-meta text-muted">
          Remitente: <span className="text-strong">{status.sender}</span>
        </span>
      )}
    </div>
  );
}

function AccountRow({ account }: { account: BrevoAccountInfo }) {
  if (!account.available) {
    return (
      <p className="text-small text-warning" role="status">
        No se pudo leer la cuenta de Brevo.{' '}
        {describeSendFailure(account.failureReason, BrevoChannel.Email)}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-small text-muted">
      <span>
        Plan:{' '}
        <span className="text-white">{formatPlanType(account.planType)}</span>
      </span>
      {account.emailCredits !== null && (
        <span>
          Correos disponibles:{' '}
          <span className="text-white">
            {account.emailCredits.toLocaleString('es-CO')}
          </span>
        </span>
      )}
      <span>
        Créditos SMS:{' '}
        <span className="text-white">
          {account.smsCredits === null
            ? 'Sin créditos comprados'
            : account.smsCredits.toLocaleString('es-CO')}
        </span>
      </span>
    </div>
  );
}
