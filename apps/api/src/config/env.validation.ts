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

  OVERDUE_REMINDER_CRON: Joi.string().default('0 9 * * 1'),

  CLIENT_URL: Joi.string().uri().required(),
});
