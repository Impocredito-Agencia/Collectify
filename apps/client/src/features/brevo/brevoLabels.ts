import {
  BrevoChannel,
  BrevoSendFailureReason,
} from '@/features/brevo/brevoApi';

import type { BrevoChannelStatus } from '@/features/brevo/brevoApi';
import type { StatusBadgeTone } from '@/components/ui/StatusBadge';

export interface ChannelStateLabel {
  label: string;
  tone: StatusBadgeTone;
  description: string;
}

// "Not configured" wins over "paused": until there's a key and a sender,
// turning the pause off wouldn't send anything either.
export function describeChannelState(
  channel: BrevoChannel,
  status: BrevoChannelStatus,
): ChannelStateLabel {
  const pauseVariable =
    channel === BrevoChannel.Sms
      ? 'BREVO_SMS_SENDING_PAUSED'
      : 'BREVO_EMAIL_SENDING_PAUSED';

  if (!status.configured) {
    return {
      label: 'Sin configurar',
      tone: 'neutral',
      description:
        channel === BrevoChannel.Sms
          ? 'Falta la API key de Brevo o el remitente de SMS en el servidor.'
          : 'Falta la API key de Brevo o el correo remitente en el servidor.',
    };
  }
  if (status.sendingPaused) {
    return {
      label: 'En pausa',
      tone: 'danger',
      description: `No sale ningún envío, salvo a la lista de prueba (${pauseVariable}).`,
    };
  }
  return {
    label: 'Activo',
    tone: 'success',
    description: 'Los envíos salen normalmente.',
  };
}

export function describeSendFailure(
  reason: BrevoSendFailureReason | null,
  channel: BrevoChannel,
): string {
  const channelLabel = channel === BrevoChannel.Sms ? 'los SMS' : 'el correo';
  switch (reason) {
    case BrevoSendFailureReason.Paused:
      return `El envío de ${channelLabel} está en pausa y este destinatario no está en la lista de prueba (BREVO_TEST_RECIPIENTS).`;
    case BrevoSendFailureReason.NotConfigured:
      return `Brevo no está configurado para ${channelLabel} en el servidor.`;
    case BrevoSendFailureReason.InvalidApiKey:
      return 'Brevo rechazó la API key. Revisa que sea correcta y esté activa.';
    case BrevoSendFailureReason.InsufficientCredits:
      return 'La cuenta de Brevo no tiene créditos suficientes. Hay que recargar.';
    case BrevoSendFailureReason.RateLimited:
      return 'Brevo recibió demasiadas solicitudes seguidas. Intenta de nuevo en un momento.';
    case BrevoSendFailureReason.NetworkError:
      return 'No se pudo conectar con Brevo. Intenta de nuevo.';
    case BrevoSendFailureReason.Rejected:
    default:
      return 'Brevo rechazó el envío.';
  }
}

const PLAN_TYPE_LABELS: Record<string, string> = {
  free: 'Gratuito',
  payAsYouGo: 'Pago por uso',
  subscription: 'Suscripción',
};

export function formatPlanType(planType: string | null): string {
  if (!planType) {
    return 'Desconocido';
  }
  return PLAN_TYPE_LABELS[planType] ?? planType;
}
