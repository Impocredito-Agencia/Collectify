import { MigrationInterface, QueryRunner } from 'typeorm';

// Human report, 2026-09-23 — "No afecte su historial crediticio" went out
// on every overdue reminder. The client rewrote the three templates that
// carried it (dropping that phrase, plus a new "Cordial saludo…" opening
// and "Quedamos atentos…" closing) and added a *_30dias copy of each that
// keeps the warning, sent only once the client's mora is MORE than 30 days
// (see reminderTemplateSelection.ts's SEVERE_MORA_THRESHOLD_DAYS).
//
// `content` is display-only (what the panel shows as sent — the real send
// is metaTemplateName + ordered parameters), but it should still read
// exactly like what the client actually received. Parameters are
// unchanged in number and order for all six, so no send-side change.
//
// Enum widening uses the same drop/recreate pattern as
// MessageTemplateCatalogV2, since the new rows are inserted in the same
// transaction (Postgres rejects a value added via ALTER TYPE ... ADD VALUE
// until that transaction commits).

const BASE_TEMPLATE_TYPES = [
  'nuevo_pagar_cliente_nuevo',
  'nuevo_pagar_cuota_inicial_cliente_nuevo',
  'nuevo_pagar_cliente_existent',
  'nuevo_pagar_cuota_inicial',
  'refinanciamiento_un_solo_pagar',
  'una_cuota_proxima_vencer',
  'varias_cuota_proxima_vencer',
  'una_cuota_vencida',
  'una_cuota_vencida_en_mora',
  'varias_cuota_vencida',
  'proxima_vencer_y_vencida',
  'confirmacion_pago',
  'pago_completo_paz_y_salvo',
];
// message_logs keeps the retired pre-Phase-33 values for historical rows.
const LEGACY_LOG_TYPES = [
  'new_loan',
  'upcoming_due',
  'overdue',
  'account_summary',
];
const NEW_TYPES = [
  'una_cuota_vencida_en_mora_30dias_2',
  'varias_cuota_vencida_30dias',
  'proxima_vencer_y_vencida_30dias',
];

interface TemplateText {
  type: string;
  name: string;
  content: string;
}

const NEW_TEMPLATES: TemplateText[] = [
  {
    type: 'una_cuota_vencida_en_mora_30dias_2',
    name: 'Una cuota vencida con recargos — mora de más de 30 días',
    content: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que la cuota *No. {{2}}* del pagaré *{{3}}* venció hace *{{4}}*.

*El valor a pagar hoy (con recargos incluidos) es {{5}}.*

*Realice su pago pronto para evitar el incremento de intereses moratorios. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}

Quedamos atentos a cualquier consulta.`,
  },
  {
    type: 'varias_cuota_vencida_30dias',
    name: 'Varias cuotas vencidas — mora de más de 30 días',
    content: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que el total de cuotas vencidas es *{{2}}*. La más antigua venció hace *{{3}}*.

*El valor a pagar hoy (con recargos incluidos) es {{4}}.*

*Realice su pago pronto para evitar el incremento de intereses moratorios. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{5}}

Quedamos atentos a cualquier consulta.`,
  },
  {
    type: 'proxima_vencer_y_vencida_30dias',
    name: 'Cuotas próximas a vencer y vencidas — mora de más de 30 días',
    content: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que el total de cuotas vencidas es *{{2}}*, por un valor de *{{3}}* (recargos incluidos).

El total de cuotas próximas a vencer es *{{4}}*, por un valor de *{{5}}*.

*Le invitamos a ponerse al día con su pago lo antes posible. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}

Quedamos atentos a cualquier consulta.`,
  },
];

// The rewritten base templates — the 30-day text above minus
// "No afecte su historial crediticio." (proxima_vencer_y_vencida confirmed
// against a real message the client received).
const UPDATED_BASE_TEMPLATES: TemplateText[] = [
  {
    type: 'una_cuota_vencida_en_mora',
    name: 'Una cuota vencida con recargos (día 9+)',
    content: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que la cuota *No. {{2}}* del pagaré *{{3}}* venció hace *{{4}}*.

*El valor a pagar hoy (con recargos incluidos) es {{5}}.*

*Realice su pago pronto para evitar el incremento de intereses moratorios.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}

Quedamos atentos a cualquier consulta.`,
  },
  {
    type: 'varias_cuota_vencida',
    name: 'Varias cuotas vencidas',
    content: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que el total de cuotas vencidas es *{{2}}*. La más antigua venció hace *{{3}}*.

*El valor a pagar hoy (con recargos incluidos) es {{4}}.*

*Realice su pago pronto para evitar el incremento de intereses moratorios.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{5}}

Quedamos atentos a cualquier consulta.`,
  },
  {
    type: 'proxima_vencer_y_vencida',
    name: 'Cuotas próximas a vencer y vencidas',
    content: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que el total de cuotas vencidas es *{{2}}*, por un valor de *{{3}}* (recargos incluidos).

El total de cuotas próximas a vencer es *{{4}}*, por un valor de *{{5}}*.

*Le invitamos a ponerse al día con su pago lo antes posible.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}

Quedamos atentos a cualquier consulta.`,
  },
];

// Pre-migration text, for down() — copied verbatim from
// MessageTemplateCatalogV2.
const PREVIOUS_BASE_CONTENT: Record<string, string> = {
  una_cuota_vencida_en_mora: `*{{1}}*, IMPROCRÉDITO le informa:

La cuota *No. {{2}}* del pagaré *{{3}}* venció hace *{{4}}*.

*El valor a pagar hoy (con recargos incluidos) es {{5}}.*

*Realice su pago pronto para evitar el incremento de intereses moratorios. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}`,
  varias_cuota_vencida: `*{{1}}*, IMPROCRÉDITO le informa:

El total de cuotas vencidas es *{{2}}*. La más antigua venció hace *{{3}}*.

*El valor a pagar hoy es {{4}} (recargos incluidos).*

*Realice su pago pronto para evitar el incremento de intereses moratorios. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{5}}`,
  proxima_vencer_y_vencida: `*{{1}}*, IMPROCRÉDITO le informa:

El total de cuotas vencidas es *{{2}}*, por un valor de *{{3}}* (recargos incluidos).

El total de cuotas próximas a vencer es *{{4}}*, por un valor de *{{5}}*.

*Le invitamos a ponerse al día con su pago lo antes posible. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}`,
};

const META_LANGUAGE_CODE = 'es';

async function recreateEnum(
  queryRunner: QueryRunner,
  table: string,
  enumName: string,
  values: string[],
): Promise<void> {
  await queryRunner.query(
    `ALTER TABLE "${table}" ALTER COLUMN "type" TYPE varchar USING "type"::text`,
  );
  await queryRunner.query(`DROP TYPE "${enumName}"`);
  await queryRunner.query(
    `CREATE TYPE "${enumName}" AS ENUM (${values.map((v) => `'${v}'`).join(', ')})`,
  );
  await queryRunner.query(
    `ALTER TABLE "${table}" ALTER COLUMN "type" TYPE "${enumName}" USING "type"::"${enumName}"`,
  );
}

export class AddOver30DaysOverdueTemplates1791000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await recreateEnum(
      queryRunner,
      'message_templates',
      'message_templates_type_enum',
      [...BASE_TEMPLATE_TYPES, ...NEW_TYPES],
    );
    await recreateEnum(queryRunner, 'message_logs', 'message_logs_type_enum', [
      ...LEGACY_LOG_TYPES,
      ...BASE_TEMPLATE_TYPES,
      ...NEW_TYPES,
    ]);

    for (const template of NEW_TEMPLATES) {
      await queryRunner.query(
        `INSERT INTO "message_templates"
           ("id", "name", "type", "content", "meta_template_name", "meta_language_code")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        // type passed twice on purpose — see MessageTemplateCatalogV2's
        // note on binding one placeholder to both an enum and a varchar.
        [
          template.name,
          template.type,
          template.content,
          template.type,
          META_LANGUAGE_CODE,
        ],
      );
    }

    for (const template of UPDATED_BASE_TEMPLATES) {
      await queryRunner.query(
        `UPDATE "message_templates" SET "content" = $1 WHERE "type" = $2`,
        [template.content, template.type],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [type, content] of Object.entries(PREVIOUS_BASE_CONTENT)) {
      await queryRunner.query(
        `UPDATE "message_templates" SET "content" = $1 WHERE "type" = $2`,
        [content, type],
      );
    }

    await queryRunner.query(
      `DELETE FROM "message_templates" WHERE "type"::text = ANY($1)`,
      [NEW_TYPES],
    );

    // Any message_logs row already sent with a new type would fail this
    // cast — acceptable for a down migration, same precedent as this
    // repo's other enum-widening migrations.
    await recreateEnum(
      queryRunner,
      'message_templates',
      'message_templates_type_enum',
      BASE_TEMPLATE_TYPES,
    );
    await recreateEnum(queryRunner, 'message_logs', 'message_logs_type_enum', [
      ...LEGACY_LOG_TYPES,
      ...BASE_TEMPLATE_TYPES,
    ]);
  }
}
