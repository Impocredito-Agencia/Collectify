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

  // Pending client's Meta Business account setup — see ENVIRONMENT_VARIABLES.md.
  // Left optional so the app boots without them; whatsapp module must fail gracefully.
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

  // Pending client's Cloudinary account setup — same "allow blank" pattern
  // as the Meta WhatsApp vars above. UploadsService fails clearly (not
  // silently) if a signature is requested while any of these are empty.
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').default(''),
  CLOUDINARY_API_KEY: Joi.string().allow('').default(''),
  CLOUDINARY_API_SECRET: Joi.string().allow('').default(''),

  OVERDUE_REMINDER_CRON: Joi.string().default('0 9 * * 1'),
  NEW_LOAN_REMINDER_CRON: Joi.string().default('0 10 * * 1'),

  CLIENT_URL: Joi.string().uri().required(),
});
