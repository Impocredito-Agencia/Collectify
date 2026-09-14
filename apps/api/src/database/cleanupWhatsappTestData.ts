import 'dotenv/config';

import { normalizePhoneNumber } from '../clients/normalizePhoneNumber';

import { AppDataSource } from './dataSource';

// One-off CLI utility — the paired teardown for seedWhatsappTestData.ts.
// Permanently (hard) deletes every row created for the two WhatsApp
// template-testing client profiles: message logs/items, inbound messages,
// conversation state, conversation tickets, audit log entries, payments,
// installments, loans, references, message-frequency overrides, and
// finally the client rows themselves. A real SQL DELETE, not TypeORM's soft-delete — this is
// disposable test data, not real business history (see docs/DATABASE.md's
// "no hard deletes" convention, which this script is a deliberate,
// narrowly-scoped exception to).
//
// Only ever targets clients whose document_number is "TEST-<digits of
// phone>" — exactly what seedWhatsappTestData.ts creates. A real client
// can never have that document number, so this can't reach real data by
// accident.
//
// Safe by default: prints what it WOULD delete and does nothing until you
// pass --confirm.
//
// Usage:
//   npm run cleanup:whatsapp-test -- +573001112233 +573004445566
//     Dry run — prints counts only.
//   npm run cleanup:whatsapp-test -- +573001112233 +573004445566 --confirm
//     Actually deletes everything found in the dry run above.

interface TargetClient {
  phoneNumber: string;
  id: string;
  fullName: string;
}

// AppDataSource.query resolves to `any` — this is the one place that
// narrows it, so every call site below gets a properly typed array
// instead of repeating an unsafe cast at each call.
async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const rows: unknown = await AppDataSource.query(sql, params);
  return rows as T[];
}

function documentNumberFor(phoneNumber: string): string {
  return `TEST-${phoneNumber.replace(/\D/g, '')}`;
}

async function findTargetClients(
  phoneNumbers: string[],
): Promise<TargetClient[]> {
  const targets: TargetClient[] = [];
  for (const phoneNumber of phoneNumbers) {
    const documentNumber = documentNumberFor(phoneNumber);
    // Raw query, deliberately ignoring the deleted_at scope TypeORM's
    // repository would apply — a prior partial/failed cleanup could have
    // left this client soft-deleted, and this script must still find and
    // finish removing it.
    const rows = await query<{
      id: string;
      first_name: string;
      last_name: string;
    }>(
      `SELECT id, first_name, last_name FROM clients WHERE document_number = $1`,
      [documentNumber],
    );

    if (rows.length === 0) {
      console.log(
        `No se encontró un cliente de prueba para ${phoneNumber} (document_number ${documentNumber}) — nada que borrar.`,
      );
      continue;
    }
    for (const row of rows) {
      targets.push({
        phoneNumber,
        id: row.id,
        fullName: `${row.first_name} ${row.last_name}`,
      });
    }
  }
  return targets;
}

async function countRows(sql: string, params: unknown[]): Promise<number> {
  const rows = await query<{ count: string }>(sql, params);
  return parseInt(rows[0]?.count ?? '0', 10);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const phoneArgs = args.filter((arg) => arg !== '--confirm');

  if (phoneArgs.length === 0) {
    console.error(
      'Uso:\n' +
        '  npm run cleanup:whatsapp-test -- +57... +57...              (dry run)\n' +
        '  npm run cleanup:whatsapp-test -- +57... +57... --confirm    (borra de verdad)',
    );
    process.exitCode = 1;
    return;
  }

  const phoneNumbers = phoneArgs.map((phone) => {
    const normalized = normalizePhoneNumber(phone);
    if (typeof normalized !== 'string') {
      throw new Error(`Número de teléfono inválido: ${phone}`);
    }
    return normalized;
  });

  await AppDataSource.initialize();

  try {
    const targets = await findTargetClients(phoneNumbers);
    if (targets.length === 0) {
      console.log('No hay clientes de prueba que borrar.');
      return;
    }

    const clientIds = targets.map((target) => target.id);

    const loanIdRows = await query<{ id: string }>(
      `SELECT id FROM loans WHERE client_id = ANY($1)`,
      [clientIds],
    );
    const loanIds = loanIdRows.map((row) => row.id);

    const installmentIdRows =
      loanIds.length > 0
        ? await query<{ id: string }>(
            `SELECT id FROM installments WHERE loan_id = ANY($1)`,
            [loanIds],
          )
        : [];
    const installmentIds = installmentIdRows.map((row) => row.id);

    const paymentIdRows =
      installmentIds.length > 0
        ? await query<{ id: string }>(
            `SELECT id FROM payments WHERE installment_id = ANY($1)`,
            [installmentIds],
          )
        : [];
    const paymentIds = paymentIdRows.map((row) => row.id);

    console.log('\nClientes de prueba encontrados:');
    for (const target of targets) {
      console.log(
        `  - ${target.fullName} (${target.phoneNumber}) — ${target.id}`,
      );
    }

    const summary = {
      message_log_items: await countRows(
        `SELECT COUNT(*) FROM message_log_items WHERE message_log_id IN (SELECT id FROM message_logs WHERE client_id = ANY($1))`,
        [clientIds],
      ),
      message_logs: await countRows(
        `SELECT COUNT(*) FROM message_logs WHERE client_id = ANY($1)`,
        [clientIds],
      ),
      whatsapp_inbound_messages: await countRows(
        `SELECT COUNT(*) FROM whatsapp_inbound_messages WHERE client_id = ANY($1)`,
        [clientIds],
      ),
      whatsapp_conversation_states: await countRows(
        `SELECT COUNT(*) FROM whatsapp_conversation_states WHERE client_id = ANY($1)`,
        [clientIds],
      ),
      // Human report, 2026-09-13 — this table's client_id is ON DELETE
      // RESTRICT (see the entity's own comment), so leaving it out here
      // would fail the final `DELETE FROM clients` below with a foreign
      // key violation for any test client who ever triggered a ticket.
      whatsapp_conversation_tickets: await countRows(
        `SELECT COUNT(*) FROM whatsapp_conversation_tickets WHERE client_id = ANY($1)`,
        [clientIds],
      ),
      audit_logs: await countRows(
        `SELECT COUNT(*) FROM audit_logs WHERE
           (entity_type = 'client' AND entity_id = ANY($1)) OR
           (entity_type = 'loan' AND entity_id = ANY($2)) OR
           (entity_type = 'installment' AND entity_id = ANY($3)) OR
           (entity_type = 'payment' AND entity_id = ANY($4))`,
        [clientIds, loanIds, installmentIds, paymentIds],
      ),
      payment_images: await countRows(
        `SELECT COUNT(*) FROM payment_images WHERE payment_id = ANY($1)`,
        [paymentIds],
      ),
      payments: paymentIds.length,
      loan_installment_concepts: await countRows(
        `SELECT COUNT(*) FROM loan_installment_concepts WHERE installment_id = ANY($1)`,
        [installmentIds],
      ),
      installments: installmentIds.length,
      loans: loanIds.length,
      client_references: await countRows(
        `SELECT COUNT(*) FROM client_references WHERE client_id = ANY($1)`,
        [clientIds],
      ),
      client_message_frequencies: await countRows(
        `SELECT COUNT(*) FROM client_message_frequencies WHERE client_id = ANY($1)`,
        [clientIds],
      ),
      clients: clientIds.length,
    };

    console.log('\nSe borrará:');
    for (const [table, count] of Object.entries(summary)) {
      console.log(`  ${table}: ${count}`);
    }

    if (!confirm) {
      console.log(
        '\nDry run — no se borró nada. Vuelve a correr el comando agregando --confirm al final para ejecutar el borrado.',
      );
      return;
    }

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(
        `DELETE FROM message_log_items WHERE message_log_id IN (SELECT id FROM message_logs WHERE client_id = ANY($1))`,
        [clientIds],
      );
      await queryRunner.query(
        `DELETE FROM message_logs WHERE client_id = ANY($1)`,
        [clientIds],
      );
      await queryRunner.query(
        `DELETE FROM whatsapp_inbound_messages WHERE client_id = ANY($1)`,
        [clientIds],
      );
      await queryRunner.query(
        `DELETE FROM whatsapp_conversation_states WHERE client_id = ANY($1)`,
        [clientIds],
      );
      await queryRunner.query(
        `DELETE FROM whatsapp_conversation_tickets WHERE client_id = ANY($1)`,
        [clientIds],
      );
      await queryRunner.query(
        `DELETE FROM audit_logs WHERE
           (entity_type = 'client' AND entity_id = ANY($1)) OR
           (entity_type = 'loan' AND entity_id = ANY($2)) OR
           (entity_type = 'installment' AND entity_id = ANY($3)) OR
           (entity_type = 'payment' AND entity_id = ANY($4))`,
        [clientIds, loanIds, installmentIds, paymentIds],
      );
      await queryRunner.query(
        `DELETE FROM payment_images WHERE payment_id = ANY($1)`,
        [paymentIds],
      );
      await queryRunner.query(
        `DELETE FROM payments WHERE installment_id = ANY($1)`,
        [installmentIds],
      );
      await queryRunner.query(
        `DELETE FROM loan_installment_concepts WHERE installment_id = ANY($1)`,
        [installmentIds],
      );
      await queryRunner.query(
        `DELETE FROM installments WHERE loan_id = ANY($1)`,
        [loanIds],
      );
      await queryRunner.query(`DELETE FROM loans WHERE client_id = ANY($1)`, [
        clientIds,
      ]);
      await queryRunner.query(
        `DELETE FROM client_references WHERE client_id = ANY($1)`,
        [clientIds],
      );
      await queryRunner.query(
        `DELETE FROM client_message_frequencies WHERE client_id = ANY($1)`,
        [clientIds],
      );
      // If either test client was ever picked as a co-debtor on a REAL
      // loan, this fails with a foreign key violation (loans.co_debtor_
      // client_id is ON DELETE RESTRICT) instead of silently orphaning
      // that loan — surfaced below via the catch block, not swallowed.
      await queryRunner.query(`DELETE FROM clients WHERE id = ANY($1)`, [
        clientIds,
      ]);

      await queryRunner.commitTransaction();
      console.log('\nListo — se borró todo lo listado arriba.');
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error(
        '\nFalló el borrado, no se cambió nada (transacción revertida). Detalle:',
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  } finally {
    await AppDataSource.destroy();
  }
}

void main();
