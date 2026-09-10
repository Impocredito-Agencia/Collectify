import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AppModule } from '../app.module';
import { ClientsService } from '../clients/clients.service';
import { DocumentType } from '../clients/entities/client.entity';
import { normalizePhoneNumber } from '../clients/normalizePhoneNumber';
import { addDaysToDateString, todayDateString } from '../loans/dueDateSchedule';
import { InstallmentsService } from '../loans/installments/installments.service';
import {
  Installment,
  InstallmentStatus,
} from '../loans/entities/installment.entity';
import {
  InstallmentFrequency,
  Loan,
  LoanStatus,
} from '../loans/entities/loan.entity';
import { LoansService } from '../loans/loans.service';

// One-off CLI utility, same pattern as seedAdmin.ts — sets up (and can
// re-run to top up) two real client profiles purely for manually testing
// every WhatsApp message template against real phones, without touching
// the real client base. Only ever sends for real to numbers listed in
// WHATSAPP_TEST_RECIPIENTS (docs/ENVIRONMENT_VARIABLES.md) — set that
// variable to these exact two phone numbers on Railway BEFORE running
// `setup` there, or nothing goes out (WHATSAPP_SENDING_PAUSED still
// blocks everyone else, which is the point).
//
// This script never hardcodes a phone number — both identities are
// supplied as CLI arguments so nothing personal ends up committed to git.
//
// Test data is tagged so cleanupWhatsappTestData.ts can find exactly (and
// only) what this script created:
//   - clients.document_number = "TEST-<digits of phone>"
//   - loans.promissory_note_number starting with "#9" (the `setup`
//     command's "new loan family" loans) or "#8" (the `reminder-scenario`
//     command's backdated reminder loans)
//
// Usage:
//   npm run seed:whatsapp-test -- setup "Nico Rojas" +573001112233 "Dev Name" +573004445566
//     Creates (or tops up) both clients and, the first time each is run,
//     fires one real WhatsApp send per synchronous template: new loan
//     (cliente nuevo, con/sin cuota inicial), new loan (cliente
//     existente, con/sin cuota inicial), refinanciamiento, confirmación
//     de pago, pago completo — 7 templates total, split across both
//     clients. Re-running `setup` for a client that already has test
//     loans is a no-op (idempotent) — run cleanup first to redo it.
//
//   npm run seed:whatsapp-test -- reminder-scenario <scenario> +573001112233 +573004445566
//     Wipes only this script's own "#8..." reminder-test loans for both
//     clients and recreates them with due dates precisely engineered to
//     trigger ONE of the 6 reminder-family templates the next time you
//     manually call POST /whatsapp/clients/:clientId/send-reminder or
//     .../send-upcoming-due (or click the equivalent button in the admin
//     panel) for each client. Run it again with a different scenario
//     between tests — each call replaces the previous scenario's loans.
//
//     Scenarios: single-overdue | single-overdue-surcharge |
//                multiple-overdue | single-upcoming | multiple-upcoming |
//                mixed

const NEW_LOAN_PRINCIPAL = 600000;
const NEW_LOAN_WITH_DOWN_PAYMENT_PRINCIPAL = 900000;
const DOWN_PAYMENT_AMOUNT = 200000;
const REFINANCE_PRINCIPAL = 700000;
const REMINDER_TEST_INSTALLMENT_AMOUNT = 150000;

interface Identity {
  name: string;
  phoneNumber: string;
}

function parseIdentity(
  name: string | undefined,
  phone: string | undefined,
): Identity {
  if (!name || !phone) {
    throw new Error(
      'Falta nombre y/o número de teléfono para un cliente de prueba.',
    );
  }
  const normalized = normalizePhoneNumber(phone);
  if (typeof normalized !== 'string') {
    throw new Error(`Número de teléfono inválido: ${phone}`);
  }
  return { name, phoneNumber: normalized };
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') || firstName };
}

function documentNumberFor(phoneNumber: string): string {
  return `TEST-${phoneNumber.replace(/\D/g, '')}`;
}

// Timestamp (ms, last 7 digits) + 2 random digits — comfortably unique
// even across several loans created in the same script run, without
// needing to query the table first. promissoryNoteNumber is globally
// unique across every loan, not just this client's.
function randomPromissoryNoteNumber(prefixDigit: string): string {
  const timestampPart = Date.now().toString().slice(-7);
  const randomPart = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, '0');
  return `#${prefixDigit}${timestampPart}${randomPart}`;
}

async function findOrCreateTestClient(
  clientsService: ClientsService,
  identity: Identity,
) {
  const documentNumber = documentNumberFor(identity.phoneNumber);
  const existing = await clientsService.findByDocumentNumber(documentNumber);
  if (existing) {
    return existing;
  }

  const { firstName, lastName } = splitName(identity.name);
  return clientsService.create({
    firstName,
    lastName,
    documentNumber,
    phoneNumber: identity.phoneNumber,
    documentType: DocumentType.CedulaCiudadania,
    homeAddress:
      'Dirección de prueba — cuenta de testing de plantillas WhatsApp',
    dataProcessingConsent: true,
  });
}

// Fires: NewLoanNewClient/NewLoanNewClientInitialInstallment (first loan),
// NewLoanExistingClient (second loan), RefinanceSingleLoan (refinancing
// the second loan), NewLoanExistingClientInitialInstallment (third loan,
// with down payment), PaymentConfirmation + PaidInFull (paying off the
// first loan's two installments in sequence).
async function runNewLoanFamilySequence(
  loansService: LoansService,
  installmentsService: InstallmentsService,
  dataSource: DataSource,
  clientId: string,
  firstLoanHasDownPayment: boolean,
): Promise<void> {
  const loanRepository = dataSource.getRepository(Loan);
  const existingSetupLoans = await loanRepository
    .createQueryBuilder('loan')
    .where('loan.client_id = :clientId', { clientId })
    .andWhere("loan.promissory_note_number LIKE '#9%'")
    .getCount();
  if (existingSetupLoans > 0) {
    Logger.log(
      `El cliente ya tiene préstamos de prueba (#9xxx) — se omite la secuencia de "nuevo préstamo". Corre cleanup primero si quieres repetirla.`,
      'seedWhatsappTestData',
    );
    return;
  }

  const today = todayDateString();
  // Must be before the first tracked (post-down-payment) installment's due
  // date — with biweekly frequency and disbursedAt = today, that's
  // today + 14 (see loans.service.ts's addWeeksToDateString(disbursedAt,
  // installmentNumber * 2)). 7 days comfortably clears that.
  const downPaymentDueDate = addDaysToDateString(today, 7);

  const loan1 = await loansService.create({
    clientId,
    promissoryNoteNumber: randomPromissoryNoteNumber('9'),
    principalAmount: firstLoanHasDownPayment
      ? NEW_LOAN_WITH_DOWN_PAYMENT_PRINCIPAL
      : NEW_LOAN_PRINCIPAL,
    disbursedAt: today,
    installmentFrequency: InstallmentFrequency.Biweekly,
    totalInstallments: 2,
    concepts: [],
    description: 'Prueba de plantilla WhatsApp — préstamo nuevo',
    isNewLoan: true,
    ...(firstLoanHasDownPayment
      ? {
          downPaymentAmount: DOWN_PAYMENT_AMOUNT,
          downPaymentDueDate,
        }
      : {}),
  });
  Logger.log(
    `Loan1 creado (${loan1.promissoryNoteNumber}) — dispara ${
      firstLoanHasDownPayment
        ? 'NewLoanNewClientInitialInstallment'
        : 'NewLoanNewClient'
    }.`,
    'seedWhatsappTestData',
  );

  const loan2 = await loansService.create({
    clientId,
    promissoryNoteNumber: randomPromissoryNoteNumber('9'),
    principalAmount: NEW_LOAN_PRINCIPAL,
    disbursedAt: today,
    installmentFrequency: InstallmentFrequency.Biweekly,
    totalInstallments: 2,
    concepts: [],
    description: 'Prueba de plantilla WhatsApp — préstamo cliente existente',
    isNewLoan: true,
  });
  Logger.log(
    `Loan2 creado (${loan2.promissoryNoteNumber}) — dispara NewLoanExistingClient.`,
    'seedWhatsappTestData',
  );

  await loansService.refinance(loan2.id, {
    principalAmount: REFINANCE_PRINCIPAL,
    disbursedAt: today,
    installmentFrequency: InstallmentFrequency.Biweekly,
    totalInstallments: 2,
    concepts: [],
    description: 'Prueba de plantilla WhatsApp — refinanciamiento',
  });
  Logger.log(
    `Loan2 (${loan2.promissoryNoteNumber}) refinanciado — dispara RefinanceSingleLoan.`,
    'seedWhatsappTestData',
  );

  const loan3 = await loansService.create({
    clientId,
    promissoryNoteNumber: randomPromissoryNoteNumber('9'),
    principalAmount: NEW_LOAN_WITH_DOWN_PAYMENT_PRINCIPAL,
    disbursedAt: today,
    installmentFrequency: InstallmentFrequency.Biweekly,
    totalInstallments: 2,
    concepts: [],
    description: 'Prueba de plantilla WhatsApp — préstamo con cuota inicial',
    isNewLoan: true,
    downPaymentAmount: DOWN_PAYMENT_AMOUNT,
    downPaymentDueDate,
  });
  Logger.log(
    `Loan3 creado (${loan3.promissoryNoteNumber}) — dispara NewLoanExistingClientInitialInstallment.`,
    'seedWhatsappTestData',
  );

  // Pay off EVERY one of loan1's installments in order (including the down
  // payment, if any) — cascadeLoanStatusIfFullyPaid only closes the loan
  // once ALL of its installments are Paid, down payment included, so
  // skipping it here would mean PaidInFull never fires. Each full payment
  // fires PaymentConfirmation; the one that finally closes the loan also
  // fires PaidInFull right after.
  const loan1Detail = await loansService.findOne(loan1.id);
  const allInstallments = [...loan1Detail.installments].sort(
    (a, b) => a.installmentNumber - b.installmentNumber,
  );
  for (const installment of allInstallments) {
    await installmentsService.registerPayment(installment.id, {
      amountPaid: installment.amount,
      paidAt: today,
    });
  }
  Logger.log(
    `Loan1 (${loan1.promissoryNoteNumber}) pagado por completo — dispara PaymentConfirmation y luego PaidInFull.`,
    'seedWhatsappTestData',
  );
}

// Removed, 2026-09-09 — this loan is built directly via loanRepository.
// create() (bypassing LoansService.create(), which always auto-assigns a
// moratory concept), so it now has zero moratory concepts and accrues $0
// mora regardless of how overdue `dueDate` is. That's harmless for what
// these scenarios actually test — reminderTemplateSelection.ts branches
// purely on overdueDays, not on the mora amount — but a scenario that
// specifically wants to eyeball a nonzero surcharge figure in the real
// WhatsApp message would need a LoanInstallmentConcept row added here.
async function createBackdatedReminderLoan(
  dataSource: DataSource,
  clientId: string,
  dueDate: string,
): Promise<void> {
  const loanRepository = dataSource.getRepository(Loan);
  const installmentRepository = dataSource.getRepository(Installment);

  const loan = await loanRepository.save(
    loanRepository.create({
      clientId,
      promissoryNoteNumber: randomPromissoryNoteNumber('8'),
      principalAmount: REMINDER_TEST_INSTALLMENT_AMOUNT,
      disbursedAt: addDaysToDateString(dueDate, -14),
      installmentFrequency: InstallmentFrequency.Biweekly,
      totalInstallments: 1,
      status: LoanStatus.Active,
      description: 'Prueba de plantilla WhatsApp — recordatorio',
      isNewLoan: false,
    }),
  );

  await installmentRepository.save(
    installmentRepository.create({
      loanId: loan.id,
      installmentNumber: 1,
      amount: REMINDER_TEST_INSTALLMENT_AMOUNT,
      dueDate,
      status: InstallmentStatus.Pending,
      isDownPayment: false,
    }),
  );
}

async function wipeReminderTestLoans(
  dataSource: DataSource,
  clientId: string,
): Promise<void> {
  const loanRepository = dataSource.getRepository(Loan);
  const staleLoans = await loanRepository
    .createQueryBuilder('loan')
    .where('loan.client_id = :clientId', { clientId })
    .andWhere("loan.promissory_note_number LIKE '#8%'")
    .getMany();

  if (staleLoans.length === 0) {
    return;
  }
  const staleLoanIds = staleLoans.map((loan) => loan.id);

  // message_log_items.installment_id has no ON DELETE CASCADE (it's meant
  // to survive an installment being soft-deleted elsewhere) — if you
  // already triggered a manual send-reminder against a previous scenario
  // for this client, its message_log_items row still points at that
  // scenario's installments and blocks the loan/installment delete below
  // with a foreign key violation. Safe to remove here: these items only
  // ever described this script's own disposable reminder-test
  // installments, never anything a real client saw.
  await dataSource.query(
    `DELETE FROM message_log_items WHERE installment_id IN (SELECT id FROM installments WHERE loan_id = ANY($1))`,
    [staleLoanIds],
  );

  // Hard delete — this is disposable test-only data (see file header), and
  // installments/loan_installment_concepts/payments cascade at the DB
  // level from loans.id (ON DELETE CASCADE, matching the entity
  // decorators — see docs/DATABASE.md).
  await loanRepository.remove(staleLoans);
}

const REMINDER_SCENARIOS = [
  'single-overdue',
  'single-overdue-surcharge',
  'multiple-overdue',
  'single-upcoming',
  'multiple-upcoming',
  'mixed',
] as const;
type ReminderScenario = (typeof REMINDER_SCENARIOS)[number];

async function runReminderScenario(
  dataSource: DataSource,
  clientsService: ClientsService,
  scenario: ReminderScenario,
  identities: Identity[],
): Promise<void> {
  const today = todayDateString();

  for (const identity of identities) {
    const client = await clientsService.findByDocumentNumber(
      documentNumberFor(identity.phoneNumber),
    );
    if (!client) {
      throw new Error(
        `No existe un cliente de prueba para ${identity.phoneNumber}. Corre "setup" primero.`,
      );
    }

    await wipeReminderTestLoans(dataSource, client.id);

    switch (scenario) {
      case 'single-overdue':
        await createBackdatedReminderLoan(
          dataSource,
          client.id,
          addDaysToDateString(today, -5),
        );
        break;
      case 'single-overdue-surcharge':
        await createBackdatedReminderLoan(
          dataSource,
          client.id,
          addDaysToDateString(today, -10),
        );
        break;
      case 'multiple-overdue':
        await createBackdatedReminderLoan(
          dataSource,
          client.id,
          addDaysToDateString(today, -3),
        );
        await createBackdatedReminderLoan(
          dataSource,
          client.id,
          addDaysToDateString(today, -17),
        );
        break;
      case 'single-upcoming':
        await createBackdatedReminderLoan(
          dataSource,
          client.id,
          addDaysToDateString(today, 3),
        );
        break;
      case 'multiple-upcoming':
        await createBackdatedReminderLoan(
          dataSource,
          client.id,
          addDaysToDateString(today, 2),
        );
        await createBackdatedReminderLoan(
          dataSource,
          client.id,
          addDaysToDateString(today, 4),
        );
        break;
      case 'mixed':
        await createBackdatedReminderLoan(
          dataSource,
          client.id,
          addDaysToDateString(today, -5),
        );
        await createBackdatedReminderLoan(
          dataSource,
          client.id,
          addDaysToDateString(today, 3),
        );
        break;
    }

    Logger.log(
      `${identity.phoneNumber}: escenario "${scenario}" listo. Llama ahora POST /whatsapp/clients/${client.id}/send-reminder (o .../send-upcoming-due para los casos "upcoming" puros) desde el panel admin.`,
      'seedWhatsappTestData',
    );
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const clientsService = app.get(ClientsService);
    const loansService = app.get(LoansService);
    const installmentsService = app.get(InstallmentsService);
    const dataSource = app.get(DataSource);

    if (command === 'setup') {
      const [name1, phone1, name2, phone2] = rest;
      const identityA = parseIdentity(name1, phone1);
      const identityB = parseIdentity(name2, phone2);

      const clientA = await findOrCreateTestClient(clientsService, identityA);
      const clientB = await findOrCreateTestClient(clientsService, identityB);

      await runNewLoanFamilySequence(
        loansService,
        installmentsService,
        dataSource,
        clientA.id,
        false,
      );
      await runNewLoanFamilySequence(
        loansService,
        installmentsService,
        dataSource,
        clientB.id,
        true,
      );

      Logger.log(
        'Listo. Recuerda que WHATSAPP_TEST_RECIPIENTS debe incluir ambos números para que estos envíos hayan salido de verdad.',
        'seedWhatsappTestData',
      );
    } else if (command === 'reminder-scenario') {
      const [scenario, phone1, phone2] = rest;
      if (!REMINDER_SCENARIOS.includes(scenario as ReminderScenario)) {
        throw new Error(
          `Escenario inválido: "${scenario}". Usa uno de: ${REMINDER_SCENARIOS.join(', ')}`,
        );
      }
      const identityA = parseIdentity('_', phone1);
      const identityB = parseIdentity('_', phone2);
      await runReminderScenario(
        dataSource,
        clientsService,
        scenario as ReminderScenario,
        [identityA, identityB],
      );
    } else {
      console.error(
        'Uso:\n' +
          '  npm run seed:whatsapp-test -- setup "Nombre 1" +57... "Nombre 2" +57...\n' +
          '  npm run seed:whatsapp-test -- reminder-scenario <escenario> +57... +57...\n' +
          `  Escenarios: ${REMINDER_SCENARIOS.join(', ')}`,
      );
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main();
