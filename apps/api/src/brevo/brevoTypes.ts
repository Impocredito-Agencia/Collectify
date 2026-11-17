export enum BrevoChannel {
  Email = 'email',
  Sms = 'sms',
}

// Why a send didn't go out. Paused/NotConfigured are decided locally,
// before any network call; the rest map Brevo's own HTTP response (see
// mapBrevoError in brevoErrors.ts).
export enum BrevoSendFailureReason {
  Paused = 'paused',
  NotConfigured = 'not_configured',
  InvalidApiKey = 'invalid_api_key',
  InsufficientCredits = 'insufficient_credits',
  RateLimited = 'rate_limited',
  Rejected = 'rejected',
  NetworkError = 'network_error',
}

// Same contract as WhatsAppService.SendMessageResult: a failed or skipped
// send is a business outcome, never a thrown error.
export interface BrevoSendResult {
  sent: boolean;
  // Brevo's id for this send — the lookup key for its delivery webhook
  // (stage 4). Email ids are strings, SMS ids numbers; both kept as text.
  providerMessageId: string | null;
  failureReason: BrevoSendFailureReason | null;
  // Brevo's own human-readable message when it rejected the call, or a
  // local explanation for Paused/NotConfigured.
  errorMessage: string | null;
}

// A file attached to an email — e.g. a signed PDF (electronic signature
// module). Either the file itself (`content`) or a public absolute URL Brevo
// downloads it from (`url`, e.g. a Cloudinary file), never both. Brevo
// checks the extension in `name` against its allowed list (pdf, png, jpg,
// docx, xlsx, csv, txt, zip…).
export interface EmailAttachment {
  // With its extension: "pagare-1021-firmado.pdf".
  name: string;
  content?: Buffer;
  url?: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  attachments?: EmailAttachment[];
}

export interface SendSmsInput {
  // E.164, e.g. +573001234567 — the format every phone is stored in.
  to: string;
  content: string;
}

export type BrevoAccountInfo =
  | {
      available: true;
      // Brevo's main plan type: free, payAsYouGo or subscription.
      planType: string | null;
      // Remaining email sends left on that plan, as Brevo reports them.
      emailCredits: number | null;
      // Remaining prepaid SMS credits; null when the account has never
      // bought any (no `sms` entry in Brevo's plan list).
      smsCredits: number | null;
    }
  | {
      available: false;
      failureReason: BrevoSendFailureReason;
      errorMessage: string;
    };

export interface BrevoChannelStatus {
  // The API key and this channel's sender are both set.
  configured: boolean;
  sendingPaused: boolean;
  sender: string | null;
}

export interface BrevoStatus {
  apiKeyConfigured: boolean;
  email: BrevoChannelStatus;
  sms: BrevoChannelStatus;
  testRecipientsCount: number;
  // Stage 4 — BREVO_WEBHOOK_SECRET is set (delivery statuses can arrive).
  // Only whether it's set, never the secret itself.
  webhookConfigured: boolean;
  account: BrevoAccountInfo;
}
