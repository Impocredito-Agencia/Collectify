// Phase 36 — which medium a message_logs row went out through. Every row
// before Phase 36 is WhatsApp. Email and SMS share their values with
// BrevoChannel (brevo/brevoTypes.ts).
export enum MessageChannel {
  WhatsApp = 'whatsapp',
  Email = 'email',
  Sms = 'sms',
}
