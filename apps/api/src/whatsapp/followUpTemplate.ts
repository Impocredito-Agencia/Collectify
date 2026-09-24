// Human report, 2026-09-24 — a re-engagement template for any inbox
// conversation whose 24h session window already closed (a free-form reply
// is rejected by Meta then, only an approved template gets through). Sent
// by hand from the inbox's "Enviar seguimiento" button, never by a cron.
// Created in Meta outside the message_templates catalog, so its name and
// language live here instead of in a row.
export const FOLLOW_UP_TEMPLATE_NAME = 'seguimiento_solicitud';
export const FOLLOW_UP_TEMPLATE_LANGUAGE_CODE = 'es';

// Used for {{1}} when the number doesn't resolve to a known client — the
// template's greeting has no other name to fall back on.
export const FOLLOW_UP_UNKNOWN_NAME = 'Señor(a)';

export interface FollowUpTemplateMessage {
  bodyParameters: string[];
  // What the client actually reads (without WhatsApp's *bold* markers),
  // logged to whatsapp_manual_replies so the inbox thread shows it.
  messageContent: string;
}

export function buildFollowUpTemplateMessage(
  client: { firstName: string; lastName: string } | null,
): FollowUpTemplateMessage {
  const fullName = client
    ? `${client.firstName} ${client.lastName}`.replace(/\s+/g, ' ').trim()
    : '';
  const name = fullName || FOLLOW_UP_UNKNOWN_NAME;

  return {
    bodyParameters: [name],
    messageContent:
      `Cordial saludo, ${name}.\n\n` +
      'Seguimos atentos a su solicitud con IMPROCRÉDITO. Por favor, respóndanos a este mensaje para que un asesor pueda continuar ayudándole. 🤝',
  };
}
