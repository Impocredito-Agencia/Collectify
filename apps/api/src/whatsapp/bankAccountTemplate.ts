// Human request, 2026-10-09 — sent by hand from the inbox's "Enviar cuenta
// bancaria" button, never by a cron. A Meta template (like
// seguimiento_solicitud, see followUpTemplate.ts), so it reaches the client
// at any time, 24h session window open or not. Created in Meta outside the
// message_templates catalog, so its name and language live here.
export const BANK_ACCOUNT_TEMPLATE_NAME = 'cuenta_bancaria';
export const BANK_ACCOUNT_TEMPLATE_LANGUAGE_CODE = 'es';

export const BANK_ACCOUNT_MAX_LENGTH = 200;

// Meta rejects a template parameter containing a newline, a tab or more
// than four consecutive spaces — so whatever the admin typed or pasted is
// flattened to a single line before it's stored.
export function normalizeBankAccount(rawBankAccount: string): string {
  return rawBankAccount.replace(/\s+/g, ' ').trim();
}

export interface BankAccountTemplateMessage {
  bodyParameters: string[];
  // What the client actually reads (without WhatsApp's *bold* markers) —
  // shown as the preview before sending and logged to
  // whatsapp_manual_replies so the inbox thread shows it.
  messageContent: string;
}

export function buildBankAccountTemplateMessage(
  bankAccount: string,
): BankAccountTemplateMessage {
  return {
    bodyParameters: [bankAccount],
    messageContent:
      'Podrás enviar el dinero de tu cuota a la siguiente cuenta bancaria, o llave BRE-B, es muy importante que leas y escribas los datos con atención:\n\n' +
      `${bankAccount}\n\n` +
      'Una vez realizado, debes enviar tu comprobante de forma clara y legible para que podamos dar procedencia a tu pago, proceso que puede tardar hasta 24 horas. Gracias!',
  };
}
