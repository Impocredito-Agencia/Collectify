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
}

export interface CronConfig {
  overdueReminderExpression: string;
  upcomingDueReminderExpression: string;
  upcomingDueReminderDays: number[];
  // Code-level default for account_summary, added to the cron mechanism in
  // Phase 18. MessageTemplate.cronExpression (DB, admin-editable) takes
  // precedence when set — see WhatsappCronService.
  accountSummaryReminderExpression: string;
  // Added 2026-09-06 — code-level default for the NewLoan family (see
  // reminderFamily.ts), same admin-editable-via-DB precedence as the
  // other two above. Supersedes the "new_loan has no cron expression at
  // all" note this comment used to carry.
  newLoanReminderExpression: string;
}

export interface Configuration {
  app: AppConfig;
  database: DatabaseConfig;
  jwt: JwtConfig;
  whatsapp: WhatsappConfig;
  cron: CronConfig;
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
  },
  cron: {
    overdueReminderExpression: process.env.OVERDUE_REMINDER_CRON ?? '0 9 * * 1',
    upcomingDueReminderExpression:
      process.env.UPCOMING_DUE_REMINDER_CRON ?? '0 8 * * *',
    upcomingDueReminderDays: (process.env.UPCOMING_DUE_REMINDER_DAYS ?? '5,3,1')
      .split(',')
      .map((value) => parseInt(value.trim(), 10)),
    // Sent to every client with an active loan — monthly, 1st of the
    // month, 8am.
    accountSummaryReminderExpression:
      process.env.ACCOUNT_SUMMARY_REMINDER_CRON ?? '0 8 1 * *',
    // Default: every Monday at 10am — matches the example the business
    // gave when this was designed (2026-09-06).
    newLoanReminderExpression:
      process.env.NEW_LOAN_REMINDER_CRON ?? '0 10 * * 1',
  },
});
