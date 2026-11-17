import { MigrationInterface, QueryRunner } from 'typeorm';

import { CHANNEL_TEMPLATE_SEEDS } from './1792000000000-CreateMessageChannelTemplatesTable';

// Phase 36 — the email/SMS reminders only ever send collection messages
// (overdue, upcoming due, Datacrédito). The email/SMS wording seeded for
// new pagaré / refinance and for payment confirmations was never used;
// removed at the human's request (2026-11-09, "99% sure they won't be
// used"). Their WhatsApp templates (message_templates) are untouched.
// `down` re-seeds the same texts.
const NON_COLLECTION_TYPES = [
  'nuevo_pagar_cliente_nuevo',
  'nuevo_pagar_cuota_inicial_cliente_nuevo',
  'nuevo_pagar_cliente_existent',
  'nuevo_pagar_cuota_inicial',
  'refinanciamiento_un_solo_pagar',
  'confirmacion_pago',
  'pago_completo_paz_y_salvo',
];

export class RemoveNonCollectionChannelTemplates1792300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "message_channel_templates" WHERE "type" = ANY($1::"message_channel_templates_type_enum"[])`,
      [NON_COLLECTION_TYPES],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const seed of CHANNEL_TEMPLATE_SEEDS.filter((s) =>
      NON_COLLECTION_TYPES.includes(s.type),
    )) {
      await queryRunner.query(
        `INSERT INTO "message_channel_templates" ("type", "channel", "subject", "body")
         VALUES ($1, 'email', $2, $3), ($1, 'sms', NULL, $4)`,
        [seed.type, seed.emailSubject, seed.emailBody, seed.sms],
      );
    }
  }
}
