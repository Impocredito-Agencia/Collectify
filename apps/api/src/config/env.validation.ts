import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),

  JWT_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),

  // Live in production since 2026-09-16 — see ENVIRONMENT_VARIABLES.md. Left
  // optional so the app still boots without them (a developer's local .env
  // has no reason to hold real credentials); whatsapp module keeps failing
  // gracefully when they're empty regardless.
  META_WHATSAPP_PHONE_NUMBER_ID: Joi.string().allow('').default(''),
  META_WHATSAPP_ACCESS_TOKEN: Joi.string().allow('').default(''),
  META_WHATSAPP_BUSINESS_ACCOUNT_ID: Joi.string().allow('').default(''),

  // Global kill switch (2026-09-06 incident response) — set to "true" to
  // stop every outbound WhatsApp send, of every type, without a code
  // change. See WhatsAppService / WhatsappConfig.sendingPaused.
  WHATSAPP_SENDING_PAUSED: Joi.boolean().default(false),

  // Test allowlist (2026-09-08) — comma-separated E.164 phone numbers that
  // bypass WHATSAPP_SENDING_PAUSED. See WhatsappConfig.testRecipients.
  // Never commit real phone numbers — set only in Railway/.env, never in
  // .env.example or any file checked into git.
  WHATSAPP_TEST_RECIPIENTS: Joi.string().allow('').default(''),

  // Narrower kill switch (2026-09-11) — stops PaymentConfirmation/
  // PaidInFull specifically while historical payments are being
  // backfilled. See WhatsappConfig.paymentConfirmationPaused.
  PAYMENT_CONFIRMATION_MESSAGES_PAUSED: Joi.boolean().default(false),

  // Phase 36 — Brevo (email + SMS). Same "allow blank" pattern as the Meta
  // vars above: BrevoService skips every send with a warning while the API
  // key is empty, so local dev needs no real credentials. See
  // docs/phases/PHASE_36_BREVO_EMAIL_SMS.md.
  BREVO_API_KEY: Joi.string().allow('').default(''),
  BREVO_SENDER_EMAIL: Joi.string().email().allow('').default(''),
  BREVO_SENDER_NAME: Joi.string().max(70).allow('').default(''),
  // Brevo's own limit: up to 11 characters when alphanumeric, up to 15
  // digits when numeric.
  BREVO_SMS_SENDER: Joi.string()
    .pattern(/^(?:\d{1,15}|(?=.*[A-Za-z])[A-Za-z0-9]{1,11})$/)
    .allow('')
    .default(''),
  BREVO_EMAIL_SENDING_PAUSED: Joi.boolean().default(false),
  // SMS costs a credit per message — paused unless explicitly "false".
  BREVO_SMS_SENDING_PAUSED: Joi.boolean().default(true),
  // Comma-separated emails and E.164 phones that bypass both pauses above.
  // Same rule as WHATSAPP_TEST_RECIPIENTS: never commit real values.
  BREVO_TEST_RECIPIENTS: Joi.string().allow('').default(''),
  // Stage 4 — Brevo's webhook calls must present this secret; empty means
  // every webhook call is rejected. Generate with `openssl rand -hex 32`.
  BREVO_WEBHOOK_SECRET: Joi.string().allow('').default(''),

  // Live in production since 2026-09-16 — same "allow blank" pattern as
  // the Meta WhatsApp vars above, kept for local dev. UploadsService fails
  // clearly (not silently) if a signature is requested while any of these
  // are empty.
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').default(''),
  CLOUDINARY_API_KEY: Joi.string().allow('').default(''),
  CLOUDINARY_API_SECRET: Joi.string().allow('').default(''),

  OVERDUE_REMINDER_CRON: Joi.string().default('0 9 * * 1'),
  NEW_LOAN_REMINDER_CRON: Joi.string().default('0 10 * * 1'),
  CREDIT_REPORT_REMINDER_CRON: Joi.string().default('0 9 * * *'),

  CLIENT_URL: Joi.string().uri().required(),
});
