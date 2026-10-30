export interface AppConfig {
  nodeEnv: string;
  port: number;
  clientUrl: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface JwtConfig {
  secret: string;
  accessExpiration: string;
  refreshExpiration: string;
}

export interface WhatsappConfig {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId: string;
  // Phase 22 — inbound webhook. webhookVerifyToken is checked against
  // Meta's hub.verify_token handshake; appSecret signs
  // X-Hub-Signature-256. See docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md.
  webhookVerifyToken: string;
  appSecret: string;
  // Global kill switch (2026-09-06 incident response) — when true, every
  // outbound send (sendTextMessage/sendTemplateMessage/
  // sendInteractiveButtonsMessage) short-circuits before ever calling
  // Meta's API, the same way a missing phoneNumberId/accessToken already
  // does. Covers every message type unconditionally — cron reminders,
  // the synchronous new-loan/payment-confirmation sends, and self-service
  // menu replies alike — since all three send methods funnel through
  // WhatsAppService. See WhatsAppService for the actual check.
  sendingPaused: boolean;
  // Test allowlist — added 2026-09-08 to let a real end-to-end WhatsApp
  // send be tested against real developer phones while
  // WHATSAPP_SENDING_PAUSED stays true for every other recipient. A
  // phoneNumber in this list bypasses sendingPaused entirely (see
  // WhatsAppService's three send methods); everyone else is still
  // blocked exactly as before. Empty by default — the allowlist is an
  // explicit, opt-in exception, never a default-open one.
  testRecipients: string[];
  // Narrower kill switch, 2026-09-11 — while historical loans AND their
  // payments are both being backfilled (Loan.isNewLoan already stops the
  // "nuevo pagaré" message for backfilled loans; this stops
  // PaymentConfirmation/PaidInFull for backfilled payments the same way,
  // since there's no per-payment "is this backfilled" flag to key off of
  // instead). Independent of sendingPaused above — composes with it
  // rather than replacing it: sendingPaused blocks every message type
  // unconditionally inside WhatsAppService; this one only blocks
  // PaymentConfirmationService's two message types, checked before that,
  // so turning sendingPaused back on for everything else doesn't
  // accidentally resume these too. Meant to be turned back off once real
  // (non-backfilled) payments start flowing through normally.
  paymentConfirmationPaused: boolean;
}

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface CronConfig {
  overdueReminderExpression: string;
  upcomingDueReminderExpression: string;
  // Simplified 2026-09-07 (human) — was a comma-separated list of three
  // exact day-before-due checkpoints ("5,3,1"), each triggering its own
  // one-shot reminder. Now that reminderInstallmentQueries.ts checks a
  // cumulative "due within N days" window instead (see its own doc
  // comment), only the largest of those three ever mattered — so this
  // simplified to a single number instead of carrying a list where two of
  // the three values were silently ignored. Default 5.
  upcomingDueReminderDays: number;
  // Code-level default for account_summary, added to the cron mechanism in
  // Phase 18. MessageTemplate.cronExpression (DB, admin-editable) takes
  // precedence when set — see WhatsappCronService.
  accountSummaryReminderExpression: string;
  // Restored 2026-09-09 — code-level default for the NewLoan family (see
  // reminderFamily.ts), same admin-editable-via-DB precedence as the
  // other two above.
  newLoanReminderExpression: string;
  // Client request, 2026-10-30 — must stay daily, see
  // CREDIT_REPORT_FAMILY_TYPES. Same admin-editable-via-DB precedence.
  creditReportReminderExpression: string;
}

// Human request, 2026-09-25 — a narrow, opt-in exception to "a loan's
// numbers are fixed at creation" (see UpdateLoanDto's comment): two loans
// were loaded from the old Excel with every pending cuota $10.000 short,
// the clients already know the real amount, and Refinanciar would send
// them a WhatsApp for a correction they don't need to hear about. Both
// switches must line up for PATCH /loans/:id/installments/amount-adjustment to
// accept a loan — the flag AND the loan's pagaré being listed — so turning
// the flag on never opens the whole loan book up to silent edits. Meant to
// stay off (and the list empty) except while a specific correction is
// being made.
export interface LoansConfig {
  installmentAdjustmentEnabled: boolean;
  installmentAdjustmentPromissoryNotes: string[];
}

export interface Configuration {
  app: AppConfig;
  database: DatabaseConfig;
  jwt: JwtConfig;
  whatsapp: WhatsappConfig;
  cloudinary: CloudinaryConfig;
  cron: CronConfig;
  loans: LoansConfig;
}

export default (): Configuration => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  },
  database: {
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
    user: process.env.DATABASE_USER ?? 'postgres',
    password: process.env.DATABASE_PASSWORD ?? 'postgres',
    name: process.env.DATABASE_NAME ?? 'collectify',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION ?? '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION ?? '7d',
  },
  whatsapp: {
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? '',
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN ?? '',
    businessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID ?? '',
    webhookVerifyToken: process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '',
    appSecret: process.env.META_WHATSAPP_APP_SECRET ?? '',
    sendingPaused: process.env.WHATSAPP_SENDING_PAUSED === 'true',
    testRecipients: (process.env.WHATSAPP_TEST_RECIPIENTS ?? '')
      .split(',')
      .map((phoneNumber) => phoneNumber.trim())
      .filter((phoneNumber) => phoneNumber.length > 0),
    paymentConfirmationPaused:
      process.env.PAYMENT_CONFIRMATION_MESSAGES_PAUSED === 'true',
  },
  cloudinary: {
    // Live in production since 2026-09-16, same status as the Meta
    // WhatsApp vars above. UploadsService throws a clear error if a
    // signature is requested while any of these are empty (still the
    // normal case in local dev), rather than silently signing with a
    // blank secret. Replaces
    // the old client-side VITE_CLOUDINARY_CLOUD_NAME/UPLOAD_PRESET
    // (unsigned preset) — every upload is now signed here so it can only
    // be requested by an authenticated user, not by anyone who copies the
    // public preset name out of the client bundle. See
    // docs/ENVIRONMENT_VARIABLES.md and apps/client/src/lib/imageUpload.ts.
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
  cron: {
    overdueReminderExpression: process.env.OVERDUE_REMINDER_CRON ?? '0 9 * * 1',
    upcomingDueReminderExpression:
      process.env.UPCOMING_DUE_REMINDER_CRON ?? '0 8 * * *',
    upcomingDueReminderDays: parseInt(
      process.env.UPCOMING_DUE_REMINDER_DAYS ?? '5',
      10,
    ),
    // Sent to every client with an active loan — monthly, 1st of the
    // month, 8am.
    accountSummaryReminderExpression:
      process.env.ACCOUNT_SUMMARY_REMINDER_CRON ?? '0 8 1 * *',
    // Default: every Monday at 10am — matches the example the business
    // gave when this was designed (2026-09-06).
    newLoanReminderExpression:
      process.env.NEW_LOAN_REMINDER_CRON ?? '0 10 * * 1',
    creditReportReminderExpression:
      process.env.CREDIT_REPORT_REMINDER_CRON ?? '0 9 * * *',
  },
  loans: {
    installmentAdjustmentEnabled:
      process.env.LOAN_INSTALLMENT_ADJUSTMENT_ENABLED === 'true',
    installmentAdjustmentPromissoryNotes: (
      process.env.LOAN_INSTALLMENT_ADJUSTMENT_PROMISSORY_NOTES ?? ''
    )
      .split(',')
      .map((promissoryNoteNumber) => promissoryNoteNumber.trim())
      .filter((promissoryNoteNumber) => promissoryNoteNumber.length > 0),
  },
});
