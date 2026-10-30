import { MigrationInterface, QueryRunner } from 'typeorm';

// Client request, 2026-10-30 — two new Meta templates warning about the
// Datacrédito report, sent only on the exact day a pagaré reaches 30 or 50
// days of mora (see creditReportTemplateSelection.ts).
//
// Enum widening uses the same drop/recreate pattern as
// AddOver30DaysOverdueTemplates, since the new rows are inserted in the same
// transaction (Postgres rejects a value added via ALTER TYPE ... ADD VALUE
// until that transaction commits).

const PREVIOUS_TEMPLATE_TYPES = [
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
  'una_cuota_vencida_en_mora_30dias_2',
  'varias_cuota_vencida_30dias',
  'proxima_vencer_y_vencida_30dias',
];
// message_logs keeps the retired pre-Phase-33 values for historical rows.
const LEGACY_LOG_TYPES = [
  'new_loan',
  'upcoming_due',
  'overdue',
  'account_summary',
];
const NEW_TYPES = ['reporte_30_dias', 'reporte_50_dias'];

const META_LANGUAGE_CODE = 'es';
// Seeded (not left null) on the family's schedule-owner row: the panel's
// schedule picker falls back to its own default for a null expression, and
// this family has to run every day to catch the exact 30th/50th day.
const DAILY_CRON_EXPRESSION = '0 9 * * *';

const NEW_TEMPLATES = [
  {
    type: 'reporte_30_dias',
    name: 'Aviso de reporte a Datacrédito — 30 días de mora',
    cronExpression: DAILY_CRON_EXPRESSION,
    content: `Cordial saludo, *{{1}}*.

Le informamos que registra 30 días de mora en el pagaré *{{2}}*, por valor de *{{3}}*.

Le recordamos que el incumplimiento de sus obligaciones puede dar lugar a un reporte ante Datacrédito, lo cual podría afectar su historial crediticio, conforme a la normativa vigente.

Le invitamos a ponerse al día con sus obligaciones a la mayor brevedad posible para evitar esta situación.

IMPROCREDITO – GESTIÓN DE CARTERA`,
  },
  {
    type: 'reporte_50_dias',
    name: 'Reporte a Datacrédito — 50 días de mora',
    cronExpression: null,
    content: `Cordial saludo, *{{1}}*.

Le informamos que registra 50 días de mora en el pagaré *{{2}}*, por valor de *{{3}}*.

Por tal motivo, será reportado ante Datacrédito, afectando su historial crediticio. El reporte y su permanencia se regirán por la normativa vigente, por lo que es importante ponerse al día con la totalidad de sus obligaciones pendientes.

IMPROCREDITO – GESTIÓN DE CARTERA`,
  },
];

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

export class AddCreditReportTemplates1791700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await recreateEnum(
      queryRunner,
      'message_templates',
      'message_templates_type_enum',
      [...PREVIOUS_TEMPLATE_TYPES, ...NEW_TYPES],
    );
    await recreateEnum(queryRunner, 'message_logs', 'message_logs_type_enum', [
      ...LEGACY_LOG_TYPES,
      ...PREVIOUS_TEMPLATE_TYPES,
      ...NEW_TYPES,
    ]);

    for (const template of NEW_TEMPLATES) {
      await queryRunner.query(
        `INSERT INTO "message_templates"
           ("id", "name", "type", "content", "meta_template_name", "meta_language_code", "cron_expression")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        // type passed twice on purpose — see MessageTemplateCatalogV2's
        // note on binding one placeholder to both an enum and a varchar.
        [
          template.name,
          template.type,
          template.content,
          template.type,
          META_LANGUAGE_CODE,
          template.cronExpression,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
      PREVIOUS_TEMPLATE_TYPES,
    );
    await recreateEnum(queryRunner, 'message_logs', 'message_logs_type_enum', [
      ...LEGACY_LOG_TYPES,
      ...PREVIOUS_TEMPLATE_TYPES,
    ]);
  }
}
