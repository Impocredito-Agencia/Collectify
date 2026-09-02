import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 33 — replaces the old 4-value message type catalog (new_loan,
// upcoming_due, overdue, account_summary) with the 13 real Meta-approved
// templates the client wrote and submitted for approval. See
// docs/phases/PHASE_33_MESSAGE_TEMPLATES_V2.md for the full spec —
// content below is the literal approved body text, for reference/display;
// the actual send uses metaTemplateName + ordered component parameters via
// WhatsAppService.sendTemplateMessage, not this column directly.
//
// message_templates is a "current config" table — its old 4 rows are
// retired outright (deleted), replaced by the 13 new ones. message_logs is
// append-only history (docs/DATABASE.md) — its enum is widened to the
// UNION of old + new values so historical rows keep whatever type they
// already have; nothing there is rewritten.
const OLD_TYPES = ['new_loan', 'upcoming_due', 'overdue', 'account_summary'];

const NEW_TYPES = [
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

interface SeedTemplate {
  type: string;
  name: string;
  content: string;
}

const SEED_TEMPLATES: SeedTemplate[] = [
  {
    type: 'nuevo_pagar_cliente_nuevo',
    name: 'Nuevo pagaré — cliente nuevo',
    content: `Cordial saludo, *{{1}}*.

*Somos IMPROCRÉDITO, la agencia encargada de la gestión de cartera de PubliMark.*

Desde este número le enviaremos recordatorios de pago y notificaciones de cumplimiento, y podrá solicitar información sobre su estado de cuenta, refinanciamiento y abonos.

El tratamiento de sus datos personales para estas comunicaciones se realiza conforme a la autorización que usted otorgó al momento de su crédito. Puede consultar nuestra política de tratamiento de datos en el enlace de este mensaje.

Registramos el pagaré *{{2}}*, obligación adquirida en la ciudad de *Pasto* con el comercio afiliado *PUBLIMARK TEC*, vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la deuda es *{{5}}*, diferido en *{{6}}* cuotas *{{7}}* de *{{8}}* cada una. Su primera cuota vence el *{{9}}*.

Quedamos atentos a brindarle más información.`,
  },
  {
    type: 'nuevo_pagar_cuota_inicial_cliente_nuevo',
    name: 'Nuevo pagaré con cuota inicial — cliente nuevo',
    content: `Cordial saludo, *{{1}}*.

*Somos IMPROCRÉDITO, la agencia encargada de la gestión de cartera de PubliMark.*

Desde este número le enviaremos recordatorios de pago y notificaciones de cumplimiento, y podrá solicitar información sobre su estado de cuenta, refinanciamiento y abonos.

El tratamiento de sus datos personales para estas comunicaciones se realiza conforme a la autorización que usted otorgó al momento de su crédito. Puede consultar nuestra política de tratamiento de datos en el enlace de este mensaje.

Registramos el pagaré *{{2}}*, obligación adquirida en la ciudad de *Pasto* con el comercio afiliado *PUBLIMARK TEC*, vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la deuda es *{{5}}*, diferido en *{{6}}* cuotas *{{7}}*: una cuota inicial de *{{8}}* y *{{9}}* cuotas restantes de *{{10}}* cada una. Su primera cuota vence el *{{11}}*.

Quedamos atentos a brindarle más información.`,
  },
  {
    type: 'nuevo_pagar_cliente_existent',
    name: 'Nuevo pagaré — cliente existente',
    content: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que registramos un nuevo pagaré en su cuenta, identificado como *{{2}}* vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la deuda es *{{5}}*, diferido en *{{6}}* cuotas *{{7}}* de *{{8}}* cada una. Su primera cuota vence el *{{9}}*.

Quedamos atentos a brindarle más información.`,
  },
  {
    type: 'nuevo_pagar_cuota_inicial',
    name: 'Nuevo pagaré con cuota inicial — cliente existente',
    content: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que registramos un nuevo pagaré en su cuenta, identificado como *{{2}}* vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la deuda es *{{5}}*, diferido en *{{6}}* cuotas *{{7}}*: una cuota inicial de *{{8}}* y *{{9}}* cuotas restantes de *{{10}}* cada una. Su primera cuota vence el *{{11}}*.

Quedamos atentos a brindarle más información.`,
  },
  {
    type: 'refinanciamiento_un_solo_pagar',
    name: 'Refinanciamiento de un solo pagaré',
    content: `Cordial saludo, *{{1}}*.

IMPROCRÉDITO le informa que se ha procedido a realizar un refinanciamiento del saldo de la deuda correspondiente al pagaré *{{2}}*.

Con el refinanciamiento efectuado, el nuevo valor total de la deuda es *{{3}}*, diferido en *{{4}}* cuotas {{5}} de *{{6}}* cada una. Su primera cuota vence el *{{7}}*.

Quedamos atentos a brindarle más información.`,
  },
  {
    type: 'una_cuota_proxima_vencer',
    name: 'Una cuota próxima a vencer',
    content: `*{{1}}*, IMPROCRÉDITO le informa:

La cuota *No. {{2}}* del pagaré *{{3}}* por *{{4}}* vence *{{5}}*.

*Le invitamos a realizar su pago en la fecha asignada.* 📆

{{6}}`,
  },
  {
    type: 'varias_cuota_proxima_vencer',
    name: 'Varias cuotas próximas a vencer',
    content: `*{{1}}*, IMPROCRÉDITO le informa:

El total de cuotas próximas a vencer es *{{2}}*, por un valor de *{{3}}*. La más próxima vence *{{4}}*.

*Le invitamos a realizar su pago en la fecha asignada.* 📆

{{5}}`,
  },
  {
    type: 'una_cuota_vencida',
    name: 'Una cuota vencida (días 1-8)',
    content: `*{{1}}*, IMPROCRÉDITO le informa:

La cuota *No. {{2}}* del pagaré *{{3}}* por *{{4}}* venció hace *{{5}}*.

*Realice su pago pronto para evitar el cobro de intereses moratorios.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}`,
  },
  {
    type: 'una_cuota_vencida_en_mora',
    name: 'Una cuota vencida con recargos (día 9+)',
    content: `*{{1}}*, IMPROCRÉDITO le informa:

La cuota *No. {{2}}* del pagaré *{{3}}* venció hace *{{4}}*.

*El valor a pagar hoy (con recargos incluidos) es {{5}}.*

*Realice su pago pronto para evitar el incremento de intereses moratorios. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}`,
  },
  {
    type: 'varias_cuota_vencida',
    name: 'Varias cuotas vencidas',
    content: `*{{1}}*, IMPROCRÉDITO le informa:

El total de cuotas vencidas es *{{2}}*. La más antigua venció hace *{{3}}*.

*El valor a pagar hoy es {{4}} (recargos incluidos).*

*Realice su pago pronto para evitar el incremento de intereses moratorios. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{5}}`,
  },
  {
    type: 'proxima_vencer_y_vencida',
    name: 'Cuotas próximas a vencer y vencidas',
    content: `*{{1}}*, IMPROCRÉDITO le informa:

El total de cuotas vencidas es *{{2}}*, por un valor de *{{3}}* (recargos incluidos).

El total de cuotas próximas a vencer es *{{4}}*, por un valor de *{{5}}*.

*Le invitamos a ponerse al día con su pago lo antes posible. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}`,
  },
  {
    type: 'confirmacion_pago',
    name: 'Confirmación de pago',
    content: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que *su pago correspondiente a la cuota No. {{2}} del pagaré {{3}} ha sido registrado*. El total de cuotas pendientes con esta obligación es *{{4}}*.

{{5}}

Que tenga un feliz día. 🤝`,
  },
  {
    type: 'pago_completo_paz_y_salvo',
    name: 'Pago completo — paz y salvo',
    content: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que *su pago correspondiente a la totalidad del pagaré {{2}} ha sido registrado*. *Se encuentra al día y a paz y salvo hasta la fecha con esta obligación.*

{{3}}

Que tenga un feliz día. 🤝`,
  },
];

const META_LANGUAGE_CODE = 'es';

export class MessageTemplateCatalogV21785900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- message_templates: retire the old 4 rows and swap the enum ---
    await queryRunner.query(`DELETE FROM "message_templates"`);
    await queryRunner.query(
      `ALTER TABLE "message_templates" ALTER COLUMN "type" TYPE varchar USING "type"::text`,
    );
    await queryRunner.query(`DROP TYPE "message_templates_type_enum"`);
    await queryRunner.query(
      `CREATE TYPE "message_templates_type_enum" AS ENUM (${NEW_TYPES.map((t) => `'${t}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ALTER COLUMN "type" TYPE "message_templates_type_enum" USING "type"::"message_templates_type_enum"`,
    );

    // --- message_logs: widen the enum to old ∪ new, no data touched ---
    const allLogTypes = [...OLD_TYPES, ...NEW_TYPES];
    await queryRunner.query(
      `ALTER TABLE "message_logs" ALTER COLUMN "type" TYPE varchar USING "type"::text`,
    );
    await queryRunner.query(`DROP TYPE "message_logs_type_enum"`);
    await queryRunner.query(
      `CREATE TYPE "message_logs_type_enum" AS ENUM (${allLogTypes.map((t) => `'${t}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_logs" ALTER COLUMN "type" TYPE "message_logs_type_enum" USING "type"::"message_logs_type_enum"`,
    );

    // --- new MessageTemplate columns ---
    await queryRunner.query(
      `ALTER TABLE "message_templates" ADD COLUMN "meta_template_name" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ADD COLUMN "meta_language_code" varchar`,
    );

    // --- seed the 13 rows ---
    for (const template of SEED_TEMPLATES) {
      await queryRunner.query(
        `INSERT INTO "message_templates"
           ("id", "name", "type", "content", "meta_template_name", "meta_language_code")
         VALUES (gen_random_uuid(), $1, $2, $3, $2, $4)`,
        [template.name, template.type, template.content, META_LANGUAGE_CODE],
      );
    }

    await queryRunner.query(
      `ALTER TABLE "message_templates" ALTER COLUMN "meta_template_name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ALTER COLUMN "meta_language_code" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_templates" DROP COLUMN "meta_language_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" DROP COLUMN "meta_template_name"`,
    );

    await queryRunner.query(`DELETE FROM "message_templates"`);

    await queryRunner.query(
      `ALTER TABLE "message_logs" ALTER COLUMN "type" TYPE varchar USING "type"::text`,
    );
    await queryRunner.query(`DROP TYPE "message_logs_type_enum"`);
    await queryRunner.query(
      `CREATE TYPE "message_logs_type_enum" AS ENUM (${OLD_TYPES.map((t) => `'${t}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_logs" ALTER COLUMN "type" TYPE "message_logs_type_enum" USING "type"::"message_logs_type_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "message_templates" ALTER COLUMN "type" TYPE varchar USING "type"::text`,
    );
    await queryRunner.query(`DROP TYPE "message_templates_type_enum"`);
    await queryRunner.query(
      `CREATE TYPE "message_templates_type_enum" AS ENUM (${OLD_TYPES.map((t) => `'${t}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ALTER COLUMN "type" TYPE "message_templates_type_enum" USING "type"::"message_templates_type_enum"`,
    );
  }
}
