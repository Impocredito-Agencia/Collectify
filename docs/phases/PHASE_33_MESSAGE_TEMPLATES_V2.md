# Phase 33 — WhatsApp Message Template Catalog v2 (Real Meta Template Messages)

## Goal

Replace the current send-as-plain-text approach with real Meta-approved **Template Messages**, and expand the message catalog from 4 broad types to the 13 specific templates the client already wrote, tested, and submitted to Meta for approval. This is the highest-priority WhatsApp work right now — the templates are already in Meta's approval queue, and the backend cannot use them correctly yet.

## Why this phase exists

`WhatsAppService.sendTextMessage` (`apps/api/src/whatsapp/whatsapp.service.ts`) only ever calls the Graph API with `type: "text"`. That works for a session message inside an open 24h window, but **Meta requires an approved Template Message (`type: "template"`) for any business-initiated send outside that window** — which is every cron-triggered reminder this system sends today (new loan, upcoming due, overdue, account summary). This phase is the first time Collectify calls Meta's actual Template Messages endpoint.

At the same time, the client (reunión the human already had, content captured verbatim below) replaced the old 4-type model with a catalog of **13 named templates**, several of them variants of what used to be a single type (e.g. "new loan" is now 5 different templates depending on new/existing client and whether there's an initial installment). The old `MessageType` enum (`new_loan`, `upcoming_due`, `overdue`, `account_summary`) and the `message_templates.type` unique-per-type model don't have enough granularity for this.

## Source of truth

The client wrote out every template body, its exact Meta variable order (`{{1}}`, `{{2}}`, ...), a worked example, and the button/behavior notes directly — this section transcribes that content in full so it survives as the permanent spec (the original working doc was local-only and is not part of this repo). Treat every template body below as **the literal, already-submitted-to-Meta text** — do not rephrase it when implementing; only the `{{n}}` values are dynamic.

Required reading alongside this: `docs/phases/PHASE_9_MESSAGE_TYPES.md` (the outbound model this replaces), `docs/phases/PHASE_18_MESSAGE_AUDIENCES.md` (per-type cron scheduling, still applies), `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md` (the inbound/button infrastructure this phase's templates plug into — its open questions about the button-flow catalog are what `docs/phases/PHASE_34_INTERACTIVE_MENU.md` resolves), `docs/DATABASE.md` (`message_templates`, `message_logs`), `docs/GLOSSARY.md`.

## Resolved — confirmed by the client, captured here verbatim

### The 13 Meta template names → what each one is

| Meta template name | What it is | Internal `MessageType` (proposed, see Open questions) |
|---|---|---|
| `nuevo_pagar_cliente_nuevo` | Template 1, variante estándar — bienvenida + primer pagaré, cliente nuevo | `nuevo_pagar_cliente_nuevo` |
| `nuevo_pagar_cuota_inicial_cliente_nuevo` | Template 1, variante con cuota inicial — cliente nuevo | `nuevo_pagar_cuota_inicial_cliente_nuevo` |
| `nuevo_pagar_cliente_existent` | Template 2, variante estándar — nuevo pagaré, cliente existente (también usado para fusión de refinanciamiento múltiple, ver más abajo) | `nuevo_pagar_cliente_existent` |
| `nuevo_pagar_cuota_inicial` | Template 2, variante con cuota inicial — cliente existente | `nuevo_pagar_cuota_inicial` |
| `refinanciamiento_un_solo_pagar` | Template 3 — refinanciamiento de un único pagaré | `refinanciamiento_un_solo_pagar` |
| `una_cuota_proxima_vencer` | Template 4 — una cuota próxima a vencer | `una_cuota_proxima_vencer` |
| `varias_cuota_proxima_vencer` | Template 5 — varias cuotas próximas a vencer | `varias_cuota_proxima_vencer` |
| `una_cuota_vencida` | Template 6, Variante A (días 1–6, sin recargos) | `una_cuota_vencida` |
| `una_cuota_vencida_en_mora` | Template 6, Variante B (día 7+, con recargos) | `una_cuota_vencida_en_mora` |
| `varias_cuota_vencida` | Template 7 — varias cuotas vencidas | `varias_cuota_vencida` |
| `proxima_vencer_y_vencida` | Template 8 — mezcla de próximas a vencer y vencidas | `proxima_vencer_y_vencida` |
| `confirmacion_pago` | Template 9 — confirmación de pago (cuota individual) | `confirmacion_pago` |
| `pago_completo_paz_y_salvo` | Template 10 — paz y salvo (pagaré completo) | `pago_completo_paz_y_salvo` |

That's all 13 — every template the client wrote maps to exactly one Meta name, with no leftovers on either side.

> **Updated 2026-10-26 (client request):** Templates 1–3 (all five new-loan / refinance variants) no longer carry the debt's total value — "El valor total de la deuda es *{{5}}*, diferido en…" became "El valor total de la obligación corresponde a…", and every later parameter shifted down by one. The cliente-nuevo pair also moved the data-treatment paragraph below the pagaré line, with new wording. The bodies below are the current ones; see migration `1791600000000-DropTotalFromNewLoanTemplates`.

> **Added 2026-10-30 (client request):** `reporte_30_dias` and `reporte_50_dias`, the Datacrédito notices. Their bodies and send rules are in `docs/DATABASE.md`'s "Avisos de Datacrédito".

### Template 1 — Bienvenida + primer pagaré (cliente nuevo)

**Meta name: `nuevo_pagar_cliente_nuevo`**

```
Cordial saludo, *{{1}}*.

*Somos IMPROCRÉDITO, la agencia encargada de la gestión de cartera de
PubliMark.*

Desde este número le enviaremos recordatorios de pago y notificaciones
de cumplimiento, y podrá solicitar información sobre su estado de
cuenta, refinanciamiento y abonos.

Registramos el pagaré *{{2}}*, obligación adquirida en la ciudad de
*Pasto* con el comercio afiliado *PUBLIMARK TEC*, vigente desde el
*{{3}}*.

El tratamiento de sus datos personales para estas comunicaciones se
realiza conforme a la autorización que usted otorgó al adquirir esta
obligación.

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}*
de *{{7}}* cada una. Su primera cuota vence el *{{8}}*.

Quedamos atentos a brindarle más información.
```

Parameters, in order: `{{1}}` tratamiento + nombre cliente, `{{2}}` # pagaré, `{{3}}` fecha de vigencia, `{{4}}` concepto (multi-línea, un ítem por línea), `{{5}}` # cuotas, `{{6}}` periodicidad, `{{7}}` valor c/cuota, `{{8}}` fecha primera cuota.

**Button:** 1 botón tipo URL ("Visitar sitio web"), texto **"Política de datos"** — enlace **estático** (mismo para todos los clientes) a la política general de tratamiento de datos, no al documento específico que el cliente firmó en papel al momento del crédito. No se llama "Ver autorización" a propósito, para no dar a entender que ahí está el documento firmado. **Bloqueado:** el cliente todavía no entrega el link real — queda con un placeholder hasta entonces. Cuando lo entregue: el link debe ser una URL https válida y **públicamente accesible, sin login** (requisito de Meta vigente desde enero de 2026 — si termina detrás de un inicio de sesión, Meta rechaza la plantilla).

**Autorización de tratamiento de datos:** solo va en esta plantilla y en su variante con cuota inicial (bienvenida, cliente nuevo) — las plantillas para clientes ya existentes NO la llevan, porque ya fue mostrada en el primer contacto.

#### Variante con cuota inicial (cliente nuevo)

**Meta name: `nuevo_pagar_cuota_inicial_cliente_nuevo`** — plantilla completa e independiente, sometida por separado a Meta, mismo encabezado/legal/botón que la estándar.

```
Cordial saludo, *{{1}}*.

*Somos IMPROCRÉDITO, la agencia encargada de la gestión de cartera de
PubliMark.*

Desde este número le enviaremos recordatorios de pago y notificaciones
de cumplimiento, y podrá solicitar información sobre su estado de
cuenta, refinanciamiento y abonos.

Registramos el pagaré *{{2}}*, obligación adquirida en la ciudad de
*Pasto* con el comercio afiliado *PUBLIMARK TEC*, vigente desde el
*{{3}}*.

El tratamiento de sus datos personales para estas comunicaciones se
realiza conforme a la autorización que usted otorgó al adquirir esta
obligación.

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}*:
una cuota inicial de *{{7}}* y *{{8}}* cuotas restantes de *{{9}}*
cada una. Su primera cuota vence el *{{10}}*.

Quedamos atentos a brindarle más información.
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # pagaré, `{{3}}` fecha vigencia, `{{4}}` concepto, `{{5}}` # cuotas, `{{6}}` periodicidad, `{{7}}` valor cuota inicial, `{{8}}` # cuotas restantes, `{{9}}` valor c/cuota restante, `{{10}}` fecha primera cuota.

### Template 2 — Nuevo pagaré (cliente existente)

**Meta name: `nuevo_pagar_cliente_existent`**

```
Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que registramos un nuevo pagaré en su
cuenta, identificado como *{{2}}* vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}*
de *{{7}}* cada una. Su primera cuota vence el *{{8}}*.

Quedamos atentos a brindarle más información.
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # pagaré, `{{3}}` fecha vigencia, `{{4}}` concepto, `{{5}}` # cuotas, `{{6}}` periodicidad, `{{7}}` valor c/cuota, `{{8}}` fecha primera cuota. No button, no legal/authorization text.

**Reused for a multi-loan refinance merge** — when several pagarés are fused into one new loan (as opposed to refinancing a single one, which uses `refinanciamiento_un_solo_pagar` below), this exact template is sent with no structural change — the detail of which pagarés were merged goes in the `{{4}}` (concepto) field instead of a product description, e.g. `"Refinanciamiento de los pagarés #1026, #994 y #1189"`.

#### Variante con cuota inicial (cliente existente)

**Meta name: `nuevo_pagar_cuota_inicial`** — plantilla completa e independiente, sometida por separado a Meta.

```
Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que registramos un nuevo pagaré en su
cuenta, identificado como *{{2}}* vigente desde el *{{3}}*.

Detalle del producto:
{{4}}

El valor total de la obligación corresponde a *{{5}}* cuotas *{{6}}*:
una cuota inicial de *{{7}}* y *{{8}}* cuotas restantes de *{{9}}*
cada una. Su primera cuota vence el *{{10}}*.

Quedamos atentos a brindarle más información.
```

Same 10-parameter shape as Template 1's cuota-inicial variant, minus the legal text.

### Template 3 — Refinanciamiento (un solo pagaré)

**Meta name: `refinanciamiento_un_solo_pagar`** — **only when a single pagaré is refinanced.** When several pagarés are merged into one, use `nuevo_pagar_cliente_existent` instead (see above) — not this one.

```
Cordial saludo, *{{1}}*.

IMPROCRÉDITO le informa que se ha procedido a realizar un
refinanciamiento del saldo de la deuda correspondiente al pagaré
*{{2}}*.

Con el refinanciamiento efectuado, el valor total de la obligación
corresponde a *{{3}}* cuotas {{4}} de *{{5}}* cada una. Su primera
cuota vence el *{{6}}*.

Quedamos atentos a brindarle más información.
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # pagaré original, `{{3}}` # cuotas nuevas, `{{4}}` periodicidad nueva, `{{5}}` valor c/cuota nueva, `{{6}}` fecha primera cuota nueva.

### Template 4 — Una cuota próxima a vencer

**Meta name: `una_cuota_proxima_vencer`**

```
*{{1}}*, IMPROCRÉDITO le informa:

La cuota *No. {{2}}* del pagaré *{{3}}* por *{{4}}* vence *{{5}}*.

*Le invitamos a realizar su pago en la fecha asignada.* 📆

{{6}}
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # cuota, `{{3}}` # pagaré, `{{4}}` valor cuota, `{{5}}` días que faltan ("hoy" / "mañana" / "en X días"), `{{6}}` **nota + cierre** — see "Mecanismo de nota adicional" below, replaces the old fixed closing line.

**Buttons (Quick Reply, up to 3):** "Ver mis cuotas" — "Ya pagué". See `docs/phases/PHASE_34_INTERACTIVE_MENU.md` for what happens after either tap.

### Template 5 — Varias cuotas próximas a vencer

**Meta name: `varias_cuota_proxima_vencer`**

```
*{{1}}*, IMPROCRÉDITO le informa:

El total de cuotas próximas a vencer es *{{2}}*, por un valor de
*{{3}}*. La más próxima vence *{{4}}*.

*Le invitamos a realizar su pago en la fecha asignada.* 📆

{{5}}
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # cuotas próximas, `{{3}}` suma valor cuotas próximas, `{{4}}` días para la más próxima, `{{5}}` nota + cierre.

**Buttons:** mismos de Template 4 — "Ver mis cuotas" — "Ya pagué".

### Template 6 — Una sola cuota vencida (dos variantes)

Split into two templates because the business doesn't charge mora until day 7 — the fixed text "(con recargos incluidos)" can't be shown/hidden conditionally inside one Meta template, so the backend picks the template by `diasVencida > MORA_GRACE_PERIOD_DAYS` (see `installmentCalculations.ts`).

**Narrowed from day 9 to day 7, 2026-09-09 (client correction):** the day count below (and the `diasVencida > 8` check) originally reflected the client's first answer; they later clarified the real cutoff: day 6 has no mora, day 7 already does — see `docs/DATABASE.md`'s note of that date. Neither Meta template's body text hardcodes a day number (both are fully parametrized via `{{5}}`/`{{4}}`'s "hace N días" phrase), so this was a selection-logic change only, no Meta resubmission needed.

#### Variante A — días 1 a 6 (aún sin recargos)

**Meta name: `una_cuota_vencida`**

```
*{{1}}*, IMPROCRÉDITO le informa:

La cuota *No. {{2}}* del pagaré *{{3}}* por *{{4}}* venció hace *{{5}}*.

*Realice su pago pronto para evitar el cobro de intereses moratorios.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # cuota, `{{3}}` # pagaré, `{{4}}` valor cuota, `{{5}}` días vencidos como frase completa ("hace 1 día" / "hace X días" — mind singular/plural), `{{6}}` nota + cierre.

**Buttons:** "Ver desglose" — "Ya pagué" — "Hablar con asesor".

#### Variante B — día 7 en adelante (recargos ya aplicados)

**Meta name: `una_cuota_vencida_en_mora`**

```
*{{1}}*, IMPROCRÉDITO le informa:

La cuota *No. {{2}}* del pagaré *{{3}}* venció hace *{{4}}*.

*El valor a pagar hoy (con recargos incluidos) es {{5}}.*

*Realice su pago pronto para evitar el incremento de intereses
moratorios. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # cuota, `{{3}}` # pagaré, `{{4}}` días vencidos (misma frase completa que Variante A), `{{5}}` valor de cuota **ya con recargos** — en su propia línea en negrita, `{{6}}` nota + cierre. No lleva `{{4}}` de valor bruto sin recargo — a diferencia de Variante A, no muestra el valor original por separado.

**Buttons:** mismos de la Variante A.

### Template 7 — Varias cuotas vencidas

**Meta name: `varias_cuota_vencida`**

```
*{{1}}*, IMPROCRÉDITO le informa:

El total de cuotas vencidas es *{{2}}*. La más antigua venció hace *{{3}}*.

*El valor a pagar hoy es {{4}} (recargos incluidos).*

*Realice su pago pronto para evitar el incremento de intereses
moratorios. No afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{5}}
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # cuotas vencidas, `{{3}}` días vencidos de la más antigua (frase completa), `{{4}}` suma valor cuotas vencidas (con recargos, línea propia en negrita), `{{5}}` nota + cierre.

**Buttons:** mismos de Template 6 — "Ver desglose" — "Ya pagué" — "Hablar con asesor".

### Template 8 — Cuotas próximas a vencer y ya vencidas (mezcla)

**Meta name: `proxima_vencer_y_vencida`**

```
*{{1}}*, IMPROCRÉDITO le informa:

El total de cuotas vencidas es *{{2}}*, por un valor de *{{3}}*
(recargos incluidos).

El total de cuotas próximas a vencer es *{{4}}*, por un valor de
*{{5}}*.

*Le invitamos a ponerse al día con su pago lo antes posible. No
afecte su historial crediticio.* 🚨

Si el pago ya fue realizado, adjunte su comprobante.

{{6}}
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # cuotas vencidas, `{{3}}` valor total vencidas, `{{4}}` # cuotas próximas, `{{5}}` valor total próximas, `{{6}}` nota + cierre.

**Buttons:** mismos de Template 6/7.

### Template 9 — Confirmación de pago (cuota individual)

**Meta name: `confirmacion_pago`** — fired synchronously at payment-registration time (like `new_loan` already is per Phase 9), not on a cron. **A partial/incomplete payment does not trigger this** — only when the covered installment is fully marked paid.

```
Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que *su pago correspondiente a la
cuota No. {{2}} del pagaré {{3}} ha sido registrado*. El total de
cuotas pendientes con esta obligación es *{{4}}*.

{{5}}

Que tenga un feliz día. 🤝
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # cuota, `{{3}}` # pagaré, `{{4}}` cuotas pendientes restantes en ese pagaré, `{{5}}` nota (solo saldo a favor / cierre neutro — ver mecanismo de nota, la variante para Plantillas 9/10 es distinta a la de 4–8, no se solapa con el cierre fijo "Que tenga un feliz día"). No buttons.

**One message per installment/loan completed** — if a single payment settles multiple installments or multiple pagarés at once, send one of these per installment/pagaré, never grouped in one message (same dynamic-list limitation as everywhere else in this catalog).

### Template 10 — Paz y salvo (pagaré completo)

**Meta name: `pago_completo_paz_y_salvo`** — fired synchronously when a pagaré's last installment is paid off.

```
Cordial saludo, *{{1}}*.

Desde IMPROCRÉDITO le informamos que *su pago correspondiente a la
totalidad del pagaré {{2}} ha sido registrado*. *Se encuentra al día
y a paz y salvo hasta la fecha con esta obligación.*

{{3}}

Que tenga un feliz día. 🤝
```

Parameters: `{{1}}` tratamiento + nombre, `{{2}}` # pagaré, `{{3}}` nota (mismo mecanismo que Template 9). No buttons.

## Mecanismo de "nota adicional" (Templates 4 through 10)

Instead of "saldo pendiente" / "saldo a favor" being lines that appear/disappear (Meta templates can't do conditional lines), it's a single `{{n}}` parameter the backend **always fills**, using one of these exact strings:

**In Templates 4, 5, 6 (both variants), 7, 8** — this parameter is the *last* one in the body and **replaces** the old fixed closing line ("Quedamos atentos..."), specifically so the normal case doesn't repeat that line twice:

- Caso normal: `"Quedamos atentos a cualquier consulta."`
- Saldo pendiente (abono incompleto — doesn't apply to 9/10): `"Cuenta con un saldo pendiente de $X por un abono incompleto. Quedamos atentos a cualquier consulta."`
- Saldo a favor: `"Cuenta con un saldo a favor de $X. Quedamos atentos a cualquier consulta."`

**In Templates 9 and 10** — the fixed closing line ("Que tenga un feliz día. 🤝") doesn't overlap with any of this, so the parameter stays in its original spot (before the closing line) and only carries the data, without repeating any closing phrase inside it:

- Caso normal: `"Quedamos atentos a cualquier consulta."`
- Saldo a favor: `"Cuenta con un saldo a favor de $X."`

**Explicitly out of scope for this phase:** automatically netting a saldo a favor against the client's next installment. That lives in the core loan/payment calculation engine, not the messaging layer, and the client wants it as an **explicit operator action** ("Aplicar saldo a favor a la próxima cuota"), not silent automatic behavior — for audit-trail reasons. This phase only needs to *read* whatever saldo-a-favor/saldo-pendiente state already exists and phrase it into the note.

## Required reading before starting

`docs/phases/PHASE_9_MESSAGE_TYPES.md`, `docs/phases/PHASE_18_MESSAGE_AUDIENCES.md`, `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md`, `docs/DATABASE.md` (`message_templates`, `message_logs`, `message_log_items`), `docs/GLOSSARY.md`, and the actual current code: `apps/api/src/whatsapp/whatsapp.service.ts`, `messageType.enum.ts`, `entities/messageTemplate.entity.ts`, `messageRenderer.ts`, `newLoanReminder.service.ts`, `upcomingDueReminder.service.ts`, `overdueReminder.service.ts`, `accountSummary.service.ts`.

## Scope

### Entities and migrations

- [x] `MessageType` enum: replace the 4 existing values with the 13 values named above, matching the Meta template names exactly.
- [x] `MessageTemplate.type` keeps its **unique-per-type** index — the "one row per type" model still holds, it's just that there are now 13 types instead of 4 instead of a single flat catalog.
- [x] `MessageTemplate` gains: `metaTemplateName` (VARCHAR — usually identical to `type`'s string value, but kept as its own column since Meta names and internal enum values are allowed to drift independently) and `metaLanguageCode` (VARCHAR, e.g. `es` or `es_CO` — **must match exactly what was selected when submitting each template to Meta**, confirm the real value before writing the migration, do not assume `es`).
- [x] Migration renaming/expanding the `message_templates_type_enum` Postgres type and seeding the 13 rows. The old `new_loan`/`upcoming_due`/`overdue` `MessageTemplate` rows are superseded (deleted/deactivated) by their Template-33 replacements; `account_summary`'s row is retired outright with no replacement (confirmed above) — no data migration needed for it beyond removing/deactivating the row.
- [x] `message_logs.type` uses the same enum — this table is append-only (`docs/DATABASE.md`), so historical rows keep whatever old enum value they already have; only the column's allowed-values set needs to accept both old and new values through the migration, no rewriting past rows.

### Service and API

- [x] `WhatsAppService`: add `sendTemplateMessage(phoneNumber, templateName, languageCode, bodyParameters, buttonComponents?)`, calling the Graph API with `type: "template"` (`template: { name, language: { code }, components: [{ type: "body", parameters: [...] }, ...] }`) — the real Template Messages endpoint, not `sendTextMessage`. Same "never throws, returns whether it sent" contract as the existing method.
- [x] A composer per template that assembles the exact ordered parameter array from domain data — reuse existing overdue/upcoming-due calculation logic (`OverdueReminderService`, `UpcomingDueReminderService`, loan/installment services), don't recompute it.
- [x] Template **selection logic** per trigger:
  - New loan: pick `nuevo_pagar_cliente_nuevo` / `nuevo_pagar_cuota_inicial_cliente_nuevo` when the client has **no other loan on file** (their first loan ever, confirmed above) vs. `nuevo_pagar_cliente_existent` / `nuevo_pagar_cuota_inicial` otherwise, vs. `refinanciamiento_un_solo_pagar` for a single-loan refinance. "Has cuota inicial" is already a fact the loan-creation flow has.
  - Upcoming due: `una_cuota_proxima_vencer` vs. `varias_cuota_proxima_vencer` by count.
  - Overdue: `una_cuota_vencida` / `una_cuota_vencida_en_mora` (by `diasVencida > 8`) vs. `varias_cuota_vencida`, plus `proxima_vencer_y_vencida` when a client has both overdue and upcoming installments at once — confirm how this interacts with the existing separate overdue/upcoming-due cron jobs (see Open questions).
- [x] New `PaymentConfirmationService` (doesn't exist today): fires `confirmacion_pago` synchronously when an installment is fully paid, and `pago_completo_paz_y_salvo` when a loan's last installment is fully paid — mirrors how `new_loan` already fires synchronously at loan creation (Phase 9), not on a cron.
- [x] "Nota adicional" composer function, shared across every template that needs it (4–10) — one function, not duplicated per service, since the three possible strings are identical everywhere except the Templates 9/10 wording difference already documented above.
- [x] `docs/phases/PHASE_34_INTERACTIVE_MENU.md` covers the buttons themselves (payload wiring, follow-up flow) — this phase only needs to attach the right button `components` when *sending* a template that has them, using whatever fixed payload strings Meta was configured with (confirm those strings — see Open questions in Phase 34).

### Tests (mandatory)

- [x] `sendTemplateMessage` calls the Graph API with the correct `type: "template"` shape, including parameter order and buttons when present.
- [x] Per-template selection logic: each branch (new/existing client, con/sin cuota inicial, single/multi refinance, una/varias upcoming, día ≤8/>8/varias overdue, mixed) picks the right template name.
- [x] "Nota adicional" composer: all three cases (normal, saldo pendiente, saldo a favor) for both the 4–8 wording and the 9/10 wording.
- [x] `confirmacion_pago` fires only on a full installment payment, never on a partial one; `pago_completo_paz_y_salvo` fires only when the loan's last installment is paid.
- [x] Refinance-merge case sends `nuevo_pagar_cliente_existent` (not `refinanciamiento_un_solo_pagar`) with the merged-pagarés list in the concepto parameter.

### Swagger

- [x] Any new/changed endpoints documented — this phase is mostly internal service logic, so this may be minimal.

## Resolved — confirmed by the human (2026-09-01)

- **`metaLanguageCode`**: `es` for all 13 templates.
- **Fate of the old `account_summary` type**: retired. Only the 13 new templates are used going forward — `account_summary` is not migrated forward as its own proactive template, and no new template replaces it 1:1. (The "estado de cuenta" self-service option in `docs/phases/PHASE_34_INTERACTIVE_MENU.md`'s menu is a separate, session-message breakdown, not this template.)
- **"New client" vs. "existing client"**: a client is "new" exactly when this is their **first loan ever** — i.e. they have no other loan (of any status) already on file. Use that as the deciding signal for the Template-1 family (`nuevo_pagar_cliente_nuevo` / `nuevo_pagar_cuota_inicial_cliente_nuevo`) vs. the Template-2 family (`nuevo_pagar_cliente_existent` / `nuevo_pagar_cuota_inicial`); no new explicit flag needed.
- **Tratamiento ({{1}} on all 13 templates)**: `Client` has no gender/salutation field, and the human confirmed not to add one — every send uses the literal string "Señor/a {nombre}" (`formatTratamiento` in `messageRenderer.ts`), regardless of the client's actual gender.

### Technical decisions (not business rules — noted here per this project's convention for judgment calls on unspecified implementation details)

- **How the mixed `proxima_vencer_y_vencida` template interacts with the overdue/upcoming-due cron jobs**: kept the existing two-job structure (confirmed with the human, one job per *family*, not one per exact template). ~~The weekly overdue job excludes any client who currently also has an upcoming installment — the daily upcoming-due job owns the mixed picture for them instead~~ — **reversed 2026-09-07 (human):** overdue installments take precedence, so the *weekly overdue job* now owns the mixed picture instead; the daily upcoming-due job excludes those clients and defers to it. Either way, the two jobs never both pick the mixed template for the same client on the same day. See `OverdueReminderService`'s doc comment.
- **The `política de datos` link (Template 1's button)**: turned out to need no swappable config on our side at all — it's a fully static URL button (no `{{n}}` suffix, "el mismo para todos los clientes"), configured entirely inside Meta's Template Manager when the template was created. `sendTemplateMessage` never sends button components for any of the 13 templates (none needs a dynamic override). Once the client provides the real link, it's updated directly in Meta — no code or env var here.

## Open questions — still blocking, do not guess

None currently open. (A promotional-image follow-up template after `pago_completo_paz_y_salvo` was floated during planning but never actually requested by the client — removed from this doc 2026-09-16 rather than tracked as pending scope.)

## Definition of done for this phase

- [x] Every one of the 13 templates can be sent via `sendTemplateMessage` with the exact parameter order and content specified above, and Meta accepts the call once each template is approved.
- [x] Every trigger (new loan, upcoming due, overdue, refinance, payment confirmation, paz y salvo) selects the correct template/variant per the rules above.
- [x] The "nota adicional" mechanism produces the correct one of three strings in every case, for both wording variants.
- [x] Every open question above has a recorded, confirmed answer before its dependent scope item is built.
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Update `docs/DATABASE.md`'s `message_templates`/`message_logs` sections with the new 13-value enum and the two new `MessageTemplate` columns; update `docs/GLOSSARY.md` if any new business term needs an entry (e.g. "nota adicional"); update `docs/phases/PHASE_9_MESSAGE_TYPES.md` and `docs/phases/PHASE_18_MESSAGE_AUDIENCES.md` with a pointer noting they're superseded by this catalog where they conflict.

**No `docs/phasesClient/PHASE_33_*.md` exists, on purpose (noted 2026-09-16):** this phase's client-side impact was small (`MessageTemplatesPage.tsx` mostly just needed to keep displaying whatever the backend now returns) and was absorbed into a single combined catch-up commit alongside Phase 34's own frontend changes (`fix(client): catch up apps/client to Phase 33/34's backend WhatsApp changes`) rather than shipped as its own discrete client-side pass — there was never a separate phasesClient scope to write down. `docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md` is the closest thing to a client-side home for the WhatsApp inbox work this phase's templates feed into.

## Related documents

- `docs/phases/PHASE_9_MESSAGE_TYPES.md`, `docs/phases/PHASE_18_MESSAGE_AUDIENCES.md` — the model this phase replaces/extends
- `docs/phases/PHASE_22_WHATSAPP_WEBHOOK.md` — the inbound infrastructure these templates' buttons plug into
- `docs/phases/PHASE_34_INTERACTIVE_MENU.md` — the button-tap flow and self-service menu built on top of this catalog
- `docs/DATABASE.md`, `docs/GLOSSARY.md`, `docs/ENVIRONMENT_VARIABLES.md`
