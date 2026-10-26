import { MigrationInterface, QueryRunner } from 'typeorm';

// Client request, 2026-10-26 — the client rewrote the five new-loan /
// refinance templates in Meta: the debt's total value is gone ("El valor
// total de la deuda es $X, diferido en N cuotas…" became "El valor total
// de la obligación corresponde a N cuotas…"), and the cliente-nuevo pair
// moved the data-treatment paragraph below the pagaré line with new
// wording. Every parameter after the dropped total shifts down by one —
// the send side is newLoanTemplateSelection.ts.
//
// `content` is display-only (what the panel shows as sent — the real send
// is metaTemplateName + ordered parameters), but it should still read
// exactly like what the client actually received.

const UPDATED_CONTENT: Record<string, string> = {
  nuevo_pagar_cliente_nuevo: `Cordial saludo, *{{1}}*.

*Somos IMPROCRÉDITO, la agencia encargada de la gestión de cartera de PubliMark.*

Desde este número le enviaremos recordatorios de pago y notificaciones de cumplimiento, y podrá solicitar información sobre su estado de cuenta, refinanciamiento y abonos.

Registramos el pagaré *{{2}}*, obligación adquirida en la ciudad de *Pasto* con el comercio afiliado *PUBLIMARK TEC*, vigente desde el *{{3}}*.

El tratamiento de sus datos personales para estas comunicaciones se realiza conforme a la autorización que usted otorgó al adquirir esta obligación.

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}* de *{{7}}* cada una. Su primera cuota vence el *{{8}}*.

Quedamos atentos a brindarle más información.`,
  nuevo_pagar_cuota_inicial_cliente_nuevo: `Cordial saludo, *{{1}}*.

*Somos IMPROCRÉDITO, la agencia encargada de la gestión de cartera de PubliMark.*

Desde este número le enviaremos recordatorios de pago y notificaciones de cumplimiento, y podrá solicitar información sobre su estado de cuenta, refinanciamiento y abonos.

Registramos el pagaré *{{2}}*, obligación adquirida en la ciudad de *Pasto* con el comercio afiliado *PUBLIMARK TEC*, vigente desde el *{{3}}*.

El tratamiento de sus datos personales para estas comunicaciones se realiza conforme a la autorización que usted otorgó al adquirir esta obligación.

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}*: una cuota inicial de *{{7}}* y *{{8}}* cuotas restantes de *{{9}}* cada una. Su primera cuota vence el *{{10}}*.

Quedamos atentos a brindarle más información.`,
  nuevo_pagar_cliente_existent: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que registramos un nuevo pagaré en su cuenta, identificado como *{{2}}* vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}* de *{{7}}* cada una. Su primera cuota vence el *{{8}}*.

Quedamos atentos a brindarle más información.`,
  nuevo_pagar_cuota_inicial: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que registramos un nuevo pagaré en su cuenta, identificado como *{{2}}* vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}*: una cuota inicial de *{{7}}* y *{{8}}* cuotas restantes de *{{9}}* cada una. Su primera cuota vence el *{{10}}*.

Quedamos atentos a brindarle más información.`,
  refinanciamiento_un_solo_pagar: `Cordial saludo, *{{1}}*.

IMPROCRÉDITO le informa que se ha procedido a realizar un refinanciamiento del saldo de la deuda correspondiente al pagaré *{{2}}*.

Con el refinanciamiento efectuado, el valor total de la obligación corresponde a *{{3}}* cuotas {{4}} de *{{5}}* cada una. Su primera cuota vence el *{{6}}*.

Quedamos atentos a brindarle más información.`,
};

const PREVIOUS_CONTENT: Record<string, string> = {
  nuevo_pagar_cliente_nuevo: `Cordial saludo, *{{1}}*.

*Somos IMPROCRÉDITO, la agencia encargada de la gestión de cartera de PubliMark.*

Desde este número le enviaremos recordatorios de pago y notificaciones de cumplimiento, y podrá solicitar información sobre su estado de cuenta, refinanciamiento y abonos.

El tratamiento de sus datos personales para estas comunicaciones se realiza conforme a la autorización que usted otorgó al momento de su crédito. Puede consultar nuestra política de tratamiento de datos en el enlace de este mensaje.

Registramos el pagaré *{{2}}*, obligación adquirida en la ciudad de *Pasto* con el comercio afiliado *PUBLIMARK TEC*, vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la deuda es *{{5}}*, diferido en *{{6}}* cuotas *{{7}}* de *{{8}}* cada una. Su primera cuota vence el *{{9}}*.

Quedamos atentos a brindarle más información.`,
  nuevo_pagar_cuota_inicial_cliente_nuevo: `Cordial saludo, *{{1}}*.

*Somos IMPROCRÉDITO, la agencia encargada de la gestión de cartera de PubliMark.*

Desde este número le enviaremos recordatorios de pago y notificaciones de cumplimiento, y podrá solicitar información sobre su estado de cuenta, refinanciamiento y abonos.

El tratamiento de sus datos personales para estas comunicaciones se realiza conforme a la autorización que usted otorgó al momento de su crédito. Puede consultar nuestra política de tratamiento de datos en el enlace de este mensaje.

Registramos el pagaré *{{2}}*, obligación adquirida en la ciudad de *Pasto* con el comercio afiliado *PUBLIMARK TEC*, vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la deuda es *{{5}}*, diferido en *{{6}}* cuotas *{{7}}*: una cuota inicial de *{{8}}* y *{{9}}* cuotas restantes de *{{10}}* cada una. Su primera cuota vence el *{{11}}*.

Quedamos atentos a brindarle más información.`,
  nuevo_pagar_cliente_existent: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que registramos un nuevo pagaré en su cuenta, identificado como *{{2}}* vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la deuda es *{{5}}*, diferido en *{{6}}* cuotas *{{7}}* de *{{8}}* cada una. Su primera cuota vence el *{{9}}*.

Quedamos atentos a brindarle más información.`,
  nuevo_pagar_cuota_inicial: `Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que registramos un nuevo pagaré en su cuenta, identificado como *{{2}}* vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la deuda es *{{5}}*, diferido en *{{6}}* cuotas *{{7}}*: una cuota inicial de *{{8}}* y *{{9}}* cuotas restantes de *{{10}}* cada una. Su primera cuota vence el *{{11}}*.

Quedamos atentos a brindarle más información.`,
  refinanciamiento_un_solo_pagar: `Cordial saludo, *{{1}}*.

IMPROCRÉDITO le informa que se ha procedido a realizar un refinanciamiento del saldo de la deuda correspondiente al pagaré *{{2}}*.

Con el refinanciamiento efectuado, el nuevo valor total de la deuda es *{{3}}*, diferido en *{{4}}* cuotas {{5}} de *{{6}}* cada una. Su primera cuota vence el *{{7}}*.

Quedamos atentos a brindarle más información.`,
};

export class DropTotalFromNewLoanTemplates1791600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [type, content] of Object.entries(UPDATED_CONTENT)) {
      await queryRunner.query(
        `UPDATE "message_templates" SET "content" = $1 WHERE "type" = $2`,
        [content, type],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [type, content] of Object.entries(PREVIOUS_CONTENT)) {
      await queryRunner.query(
        `UPDATE "message_templates" SET "content" = $1 WHERE "type" = $2`,
        [content, type],
      );
    }
  }
}
