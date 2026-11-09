import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

// Phase 36, stage 2 — email and SMS wording per message type, editable from
// the panel (see MessageChannelTemplate). Seeded with a first version of
// every text, adapted from the WhatsApp template of the same type and
// filled with the same {{n}} values (MESSAGE_TYPE_PARAMETERS). The SMS
// texts are kept short: each 160 characters (after accents are dropped,
// see smsText.ts) is one Brevo credit. The business is expected to review
// and adjust all of them from the panel before email/SMS go live.
//
// Self-contained on purpose (no imports from app code): a migration must
// keep producing the same result even if the enums or texts change later.

const MESSAGE_TYPES = [
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
  'una_cuota_vencida_en_mora_30dias_2',
  'varias_cuota_vencida_30dias',
  'proxima_vencer_y_vencida_30dias',
  'reporte_30_dias',
  'reporte_50_dias',
  'confirmacion_pago',
  'pago_completo_paz_y_salvo',
];

export interface ChannelTemplateSeed {
  type: string;
  emailSubject: string;
  emailBody: string;
  sms: string;
}

const NEW_CLIENT_INTRO = `*Somos IMPROCRÉDITO, la agencia encargada de la gestión de cartera de PubliMark.*

Por este medio le enviaremos recordatorios de pago y notificaciones de cumplimiento.`;

const DATA_TREATMENT = `El tratamiento de sus datos personales para estas comunicaciones se realiza conforme a la autorización que usted otorgó al adquirir esta obligación.`;

const ALREADY_PAID = `Si ya realizó el pago, haga caso omiso de este mensaje.`;

// Exported only so a spec can check every seeded text against
// MESSAGE_TYPE_PARAMETERS and the SMS length; TypeORM ignores non-class
// exports when it loads migrations.
export const CHANNEL_TEMPLATE_SEEDS: ChannelTemplateSeed[] = [
  {
    type: 'nuevo_pagar_cliente_nuevo',
    emailSubject: 'Bienvenido a IMPROCRÉDITO — pagaré {{2}}',
    emailBody: `Cordial saludo, *{{1}}*.

${NEW_CLIENT_INTRO}

Registramos el pagaré *{{2}}*, obligación adquirida en la ciudad de *Pasto* con el comercio afiliado *PUBLIMARK TEC*, vigente desde el *{{3}}*.

${DATA_TREATMENT}

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}* de *{{7}}* cada una. Su primera cuota vence el *{{8}}*.

Quedamos atentos a brindarle más información.`,
    sms: 'IMPROCREDITO: {{1}}, registramos su pagaré {{2}}: {{5}} cuotas {{6}} de {{7}}. Primera cuota: {{8}}.',
  },
  {
    type: 'nuevo_pagar_cuota_inicial_cliente_nuevo',
    emailSubject: 'Bienvenido a IMPROCRÉDITO — pagaré {{2}}',
    emailBody: `Cordial saludo, *{{1}}*.

${NEW_CLIENT_INTRO}

Registramos el pagaré *{{2}}*, obligación adquirida en la ciudad de *Pasto* con el comercio afiliado *PUBLIMARK TEC*, vigente desde el *{{3}}*.

${DATA_TREATMENT}

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}*: una cuota inicial de *{{7}}* y *{{8}}* cuotas restantes de *{{9}}* cada una. Su primera cuota vence el *{{10}}*.

Quedamos atentos a brindarle más información.`,
    sms: 'IMPROCREDITO: {{1}}, registramos el pagaré {{2}}. Cuota inicial {{7}} y {{8}} cuotas {{6}} de {{9}}. 1a cuota: {{10}}.',
  },
  {
    type: 'nuevo_pagar_cliente_existent',
    emailSubject: 'Nuevo pagaré {{2}} registrado',
    emailBody: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que registramos un nuevo pagaré en su cuenta, identificado como *{{2}}* vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}* de *{{7}}* cada una. Su primera cuota vence el *{{8}}*.

Quedamos atentos a brindarle más información.`,
    sms: 'IMPROCREDITO: {{1}}, registramos un nuevo pagaré {{2}}: {{5}} cuotas {{6}} de {{7}}. Primera cuota: {{8}}.',
  },
  {
    type: 'nuevo_pagar_cuota_inicial',
    emailSubject: 'Nuevo pagaré {{2}} registrado',
    emailBody: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que registramos un nuevo pagaré en su cuenta, identificado como *{{2}}* vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}*: una cuota inicial de *{{7}}* y *{{8}}* cuotas restantes de *{{9}}* cada una. Su primera cuota vence el *{{10}}*.

Quedamos atentos a brindarle más información.`,
    sms: 'IMPROCREDITO: {{1}}, nuevo pagaré {{2}} registrado. Cuota inicial {{7}} y {{8}} cuotas {{6}} de {{9}}. 1a cuota: {{10}}.',
  },
  {
    type: 'refinanciamiento_un_solo_pagar',
    emailSubject: 'Refinanciamiento del pagaré {{2}}',
    emailBody: `Cordial saludo, *{{1}}*.

IMPROCRÉDITO le informa que se ha procedido a realizar un refinanciamiento del saldo de la deuda correspondiente al pagaré *{{2}}*.

Con el refinanciamiento efectuado, el valor total de la obligación corresponde a *{{3}}* cuotas {{4}} de *{{5}}* cada una. Su primera cuota vence el *{{6}}*.

Quedamos atentos a brindarle más información.`,
    sms: 'IMPROCREDITO: {{1}}, refinanciamos su pagaré {{2}}: {{3}} cuotas {{4}} de {{5}}. Primera cuota: {{6}}.',
  },
  {
    type: 'una_cuota_proxima_vencer',
    emailSubject: 'Su cuota No. {{2}} vence {{5}}',
    emailBody: `*{{1}}*, IMPROCRÉDITO le informa:

La cuota *No. {{2}}* del pagaré *{{3}}* por *{{4}}* vence *{{5}}*.

*Le invitamos a realizar su pago en la fecha asignada.*

{{6}}`,
    sms: 'IMPROCREDITO: {{1}}, la cuota {{2}} del pagaré {{3}} por {{4}} vence {{5}}. {{6}}',
  },
  {
    type: 'varias_cuota_proxima_vencer',
    emailSubject: 'Tiene {{2}} cuotas próximas a vencer',
    emailBody: `*{{1}}*, IMPROCRÉDITO le informa:

El total de cuotas próximas a vencer es *{{2}}*, por un valor de *{{3}}*. La más próxima vence *{{4}}*.

*Le invitamos a realizar su pago en la fecha asignada.*

{{5}}`,
    sms: 'IMPROCREDITO: {{1}}, tiene {{2}} cuotas por {{3}} próximas a vencer. La primera vence {{4}}. {{5}}',
  },
  {
    type: 'una_cuota_vencida',
    emailSubject: 'Su cuota No. {{2}} está vencida',
    emailBody: `*{{1}}*, IMPROCRÉDITO le informa:

La cuota *No. {{2}}* del pagaré *{{3}}* por *{{4}}* venció *{{5}}*.

*Realice su pago pronto para evitar el cobro de intereses moratorios.*

${ALREADY_PAID}

{{6}}`,
    sms: 'IMPROCREDITO: {{1}}, la cuota {{2}} del pagaré {{3}} por {{4}} venció {{5}}. Evite intereses de mora pagando pronto. {{6}}',
  },
  {
    type: 'una_cuota_vencida_en_mora',
    emailSubject: 'Su cuota No. {{2}} está vencida',
    emailBody: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que la cuota *No. {{2}}* del pagaré *{{3}}* venció *{{4}}*.

*El valor a pagar hoy (con recargos incluidos) es {{5}}.*

*Realice su pago pronto para evitar el incremento de intereses moratorios.*

${ALREADY_PAID}

{{6}}

Quedamos atentos a cualquier consulta.`,
    sms: 'IMPROCREDITO: {{1}}, la cuota {{2}} del pagaré {{3}} venció {{4}}. Valor a pagar hoy con recargos: {{5}}. {{6}}',
  },
  {
    type: 'varias_cuota_vencida',
    emailSubject: 'Tiene {{2}} cuotas vencidas',
    emailBody: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que el total de cuotas vencidas es *{{2}}*. La más antigua venció *{{3}}*.

*El valor a pagar hoy (con recargos incluidos) es {{4}}.*

*Realice su pago pronto para evitar el incremento de intereses moratorios.*

${ALREADY_PAID}

{{5}}

Quedamos atentos a cualquier consulta.`,
    sms: 'IMPROCREDITO: {{1}}, tiene {{2}} cuotas vencidas, la más antigua {{3}}. Valor a pagar hoy con recargos: {{4}}. {{5}}',
  },
  {
    type: 'proxima_vencer_y_vencida',
    emailSubject: 'Tiene cuotas vencidas y próximas a vencer',
    emailBody: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que el total de cuotas vencidas es *{{2}}*, por un valor de *{{3}}* (recargos incluidos).

El total de cuotas próximas a vencer es *{{4}}*, por un valor de *{{5}}*.

*Le invitamos a ponerse al día con su pago lo antes posible.*

${ALREADY_PAID}

{{6}}

Quedamos atentos a cualquier consulta.`,
    sms: 'IMPROCREDITO: {{1}}, tiene {{2}} cuotas vencidas por {{3}} (con recargos) y {{4}} por vencer por {{5}}. Póngase al día pronto. {{6}}',
  },
  {
    type: 'una_cuota_vencida_en_mora_30dias_2',
    emailSubject: 'Su cuota No. {{2}} está vencida',
    emailBody: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que la cuota *No. {{2}}* del pagaré *{{3}}* venció *{{4}}*.

*El valor a pagar hoy (con recargos incluidos) es {{5}}.*

*Realice su pago pronto para evitar el incremento de intereses moratorios. No afecte su historial crediticio.*

${ALREADY_PAID}

{{6}}

Quedamos atentos a cualquier consulta.`,
    sms: 'IMPROCREDITO: {{1}}, la cuota {{2}} del pagaré {{3}} venció {{4}}. Pague hoy {{5}} (con recargos) y no afecte su historial crediticio. {{6}}',
  },
  {
    type: 'varias_cuota_vencida_30dias',
    emailSubject: 'Tiene {{2}} cuotas vencidas',
    emailBody: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que el total de cuotas vencidas es *{{2}}*. La más antigua venció *{{3}}*.

*El valor a pagar hoy (con recargos incluidos) es {{4}}.*

*Realice su pago pronto para evitar el incremento de intereses moratorios. No afecte su historial crediticio.*

${ALREADY_PAID}

{{5}}

Quedamos atentos a cualquier consulta.`,
    sms: 'IMPROCREDITO: {{1}}, tiene {{2}} cuotas vencidas, la más antigua {{3}}. Pague hoy {{4}} (con recargos) y no afecte su historial crediticio. {{5}}',
  },
  {
    type: 'proxima_vencer_y_vencida_30dias',
    emailSubject: 'Tiene cuotas vencidas y próximas a vencer',
    emailBody: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que el total de cuotas vencidas es *{{2}}*, por un valor de *{{3}}* (recargos incluidos).

El total de cuotas próximas a vencer es *{{4}}*, por un valor de *{{5}}*.

*Le invitamos a ponerse al día con su pago lo antes posible. No afecte su historial crediticio.*

${ALREADY_PAID}

{{6}}

Quedamos atentos a cualquier consulta.`,
    sms: 'IMPROCREDITO: {{1}}, tiene {{2}} cuotas vencidas por {{3}} (con recargos) y {{4}} por vencer por {{5}}. Póngase al día y no afecte su historial crediticio. {{6}}',
  },
  {
    type: 'reporte_30_dias',
    emailSubject: 'Aviso de mora — pagaré {{2}}',
    emailBody: `Cordial saludo, *{{1}}*.

Le informamos que registra 30 días de mora en el pagaré *{{2}}*, por valor de *{{3}}*.

Le recordamos que el incumplimiento de sus obligaciones puede dar lugar a un reporte ante Datacrédito, lo cual podría afectar su historial crediticio, conforme a la normativa vigente.

Le invitamos a ponerse al día con sus obligaciones a la mayor brevedad posible para evitar esta situación.

IMPROCRÉDITO – GESTIÓN DE CARTERA`,
    sms: 'IMPROCREDITO: {{1}}, registra 30 días de mora en el pagaré {{2}} por {{3}}. Su incumplimiento puede ser reportado a Datacrédito. Póngase al día.',
  },
  {
    type: 'reporte_50_dias',
    emailSubject: 'Aviso de reporte a Datacrédito — pagaré {{2}}',
    emailBody: `Cordial saludo, *{{1}}*.

Le informamos que registra 50 días de mora en el pagaré *{{2}}*, por valor de *{{3}}*.

Por tal motivo, será reportado ante Datacrédito, afectando su historial crediticio. El reporte y su permanencia se regirán por la normativa vigente, por lo que es importante ponerse al día con la totalidad de sus obligaciones pendientes.

IMPROCRÉDITO – GESTIÓN DE CARTERA`,
    sms: 'IMPROCREDITO: {{1}}, registra 50 días de mora en el pagaré {{2}} por {{3}}. Será reportado ante Datacrédito. Póngase al día con sus obligaciones.',
  },
  {
    type: 'confirmacion_pago',
    emailSubject: 'Pago registrado — pagaré {{3}}',
    emailBody: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que *su pago correspondiente a la cuota No. {{2}} del pagaré {{3}} ha sido registrado*. El total de cuotas pendientes con esta obligación es *{{4}}*.

{{5}}

Que tenga un feliz día.`,
    sms: 'IMPROCREDITO: {{1}}, registramos su pago de la cuota {{2}} del pagaré {{3}}. Cuotas pendientes: {{4}}. {{5}}',
  },
  {
    type: 'pago_completo_paz_y_salvo',
    emailSubject: 'Paz y salvo — pagaré {{2}}',
    emailBody: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que *su pago correspondiente a la totalidad del pagaré {{2}} ha sido registrado*. *Se encuentra al día y a paz y salvo hasta la fecha con esta obligación.*

{{3}}

Que tenga un feliz día.`,
    sms: 'IMPROCREDITO: {{1}}, registramos el pago total del pagaré {{2}}. Se encuentra a paz y salvo con esta obligación. {{3}}',
  },
];

export class CreateMessageChannelTemplatesTable1792000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const typeValues = MESSAGE_TYPES.map((type) => `'${type}'`).join(', ');
    await queryRunner.query(
      `CREATE TYPE "message_channel_templates_type_enum" AS ENUM (${typeValues})`,
    );
    await queryRunner.query(
      `CREATE TYPE "message_channel_templates_channel_enum" AS ENUM ('email', 'sms')`,
    );

    await queryRunner.createTable(
      new Table({
        name: 'message_channel_templates',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'type', type: 'message_channel_templates_type_enum' },
          { name: 'channel', type: 'message_channel_templates_channel_enum' },
          { name: 'subject', type: 'varchar', isNullable: true },
          { name: 'body', type: 'text' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
          { name: 'deleted_at', type: 'timestamptz', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'message_channel_templates',
      new TableIndex({
        name: 'IDX_message_channel_templates_type_channel',
        columnNames: ['type', 'channel'],
        isUnique: true,
      }),
    );

    for (const seed of CHANNEL_TEMPLATE_SEEDS) {
      await queryRunner.query(
        `INSERT INTO "message_channel_templates" ("type", "channel", "subject", "body")
         VALUES ($1, 'email', $2, $3), ($1, 'sms', NULL, $4)`,
        [seed.type, seed.emailSubject, seed.emailBody, seed.sms],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('message_channel_templates');
    await queryRunner.query(
      `DROP TYPE "message_channel_templates_channel_enum"`,
    );
    await queryRunner.query(`DROP TYPE "message_channel_templates_type_enum"`);
  }
}
