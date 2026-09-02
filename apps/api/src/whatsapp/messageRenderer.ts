// Renders the overdue reminder message — confirmed real format from
// docs/GLOSSARY.md → "Overdue reminder":
//
//   [Client greeting]
//   1️⃣ La cuota No. X del pagaré #Y por $Z (incluidos intereses) venció hace N días.
//   2️⃣ ...
//   El valor a pagar hoy es $[grand total]
//
// The per-installment line format is fixed (matches the confirmed real
// message exactly, per docs/DATABASE.md's placeholder structure) — only the
// outer template (greeting + where the list/total go) is admin-editable via
// MessageTemplate.content, using {{clientFullName}}, {{installmentsList}},
// {{grandTotal}}. {{grandTotal}} is substituted WITH a leading "$" already
// included (e.g. "$158.000"), matching how the $ is baked into every
// installment line — template authors should not type a $ before it.

const NUMBER_EMOJIS = [
  '1️⃣',
  '2️⃣',
  '3️⃣',
  '4️⃣',
  '5️⃣',
  '6️⃣',
  '7️⃣',
  '8️⃣',
  '9️⃣',
  '🔟',
];

export interface OverdueInstallmentForMessage {
  installmentNumber: number;
  promissoryNoteNumber: string;
  totalDue: number;
  overdueDays: number;
}

export function formatCurrency(amount: number): string {
  return Math.round(amount).toLocaleString('es-CO');
}

function bulletForIndex(index: number): string {
  return NUMBER_EMOJIS[index] ?? `${index + 1}.`;
}

function renderInstallmentLine(
  item: OverdueInstallmentForMessage,
  index: number,
): string {
  return (
    `${bulletForIndex(index)} La cuota No. ${item.installmentNumber} del pagaré ` +
    `#${item.promissoryNoteNumber} por $${formatCurrency(item.totalDue)} ` +
    `(incluidos intereses) venció hace ${item.overdueDays} días.`
  );
}

export function calculateGrandTotal(
  installments: OverdueInstallmentForMessage[],
): number {
  return installments.reduce((sum, item) => sum + item.totalDue, 0);
}

export function renderOverdueReminderMessage(
  templateContent: string,
  clientFullName: string,
  installments: OverdueInstallmentForMessage[],
): string {
  const installmentsList = installments.map(renderInstallmentLine).join('\n');
  const grandTotal = formatCurrency(calculateGrandTotal(installments));

  return templateContent
    .replaceAll('{{clientFullName}}', clientFullName)
    .replaceAll('{{installmentsList}}', installmentsList)
    .replaceAll('{{grandTotal}}', `$${grandTotal}`);
}

// ── New loan ("Primera vez") ────────────────────────────────────────────
// Sent once, at loan creation — confirms the pagaré terms to the client.
// See docs/phases/PHASE_9_MESSAGE_TYPES.md.

const SPANISH_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

// Formats a 'YYYY-MM-DD' date column value as "20 de mayo de 2026" —
// manual UTC parsing (not date-fns) for the same reason as
// loans/dueDateSchedule.ts: avoids the local-timezone shift that comes
// from combining a UTC-midnight date string with locale-aware Date methods.
export function formatDateEs(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number);
  return `${day} de ${SPANISH_MONTHS[month - 1]} de ${year}`;
}

// The "tratamiento + nombre cliente" {{1}} used by all 13 Phase 33
// templates. Client has no gender/salutation field, and the human
// confirmed (2026-09-01) not to add one — "Señor/a" is the deliberate,
// gender-neutral stand-in for "Señor"/"Señora", used as a literal string
// for every client rather than picking one or the other.
export function formatTratamiento(clientFullName: string): string {
  return `Señor/a ${clientFullName}`;
}

export interface NewLoanMessageData {
  clientFullName: string;
  promissoryNoteNumber: string;
  loanDescription: string | null;
  disbursedAt: string;
  totalInstallments: number;
  installmentAmounts: number[];
}

// "cada una de $X" when every installment has the same amount (the common
// case), otherwise a short per-installment breakdown — installments can
// legitimately vary per docs/DATABASE.md.
function renderInstallmentsSummary(installmentAmounts: number[]): string {
  const [first, ...rest] = installmentAmounts;
  const allEqual = rest.every((amount) => amount === first);

  if (allEqual) {
    return `cada una de $${formatCurrency(first)}`;
  }

  return installmentAmounts
    .map((amount, index) => `cuota ${index + 1}: $${formatCurrency(amount)}`)
    .join(', ');
}

export function renderNewLoanMessage(
  templateContent: string,
  data: NewLoanMessageData,
): string {
  return templateContent
    .replaceAll('{{clientFullName}}', data.clientFullName)
    .replaceAll('{{promissoryNoteNumber}}', data.promissoryNoteNumber)
    .replaceAll('{{loanDescription}}', data.loanDescription ?? '')
    .replaceAll('{{disbursedAt}}', formatDateEs(data.disbursedAt))
    .replaceAll('{{totalInstallments}}', String(data.totalInstallments))
    .replaceAll(
      '{{installmentsSummary}}',
      renderInstallmentsSummary(data.installmentAmounts),
    );
}

// ── Upcoming due reminder ("Aviso") ─────────────────────────────────────
// Sent as an installment approaches its due date. Same consolidated-by-
// client structure as the overdue reminder, but "vence en N días" instead
// of "venció hace N días", and — confirmed from the real "Aviso" example —
// no grand total line and no mention of interest (not overdue yet).

export interface UpcomingInstallmentForMessage {
  installmentNumber: number;
  promissoryNoteNumber: string;
  amount: number;
  daysUntilDue: number;
}

function renderUpcomingInstallmentLine(
  item: UpcomingInstallmentForMessage,
  index: number,
): string {
  return (
    `${bulletForIndex(index)} La cuota No. ${item.installmentNumber} del pagaré ` +
    `#${item.promissoryNoteNumber} por $${formatCurrency(item.amount)} ` +
    `vence en ${item.daysUntilDue} días.`
  );
}

export function renderUpcomingDueMessage(
  templateContent: string,
  clientFullName: string,
  installments: UpcomingInstallmentForMessage[],
): string {
  const installmentsList = installments
    .map(renderUpcomingInstallmentLine)
    .join('\n');

  return templateContent
    .replaceAll('{{clientFullName}}', clientFullName)
    .replaceAll('{{installmentsList}}', installmentsList);
}

// ── Account summary ("Estado de cuenta") ────────────────────────────────
// On-demand — every pending installment for a client, overdue or not,
// across all their active loans, ending in a grand total.

export interface AccountSummaryInstallmentForMessage {
  installmentNumber: number;
  promissoryNoteNumber: string;
  totalDue: number;
  overdueDays: number;
  daysUntilDue: number;
}

function renderAccountSummaryInstallmentLine(
  item: AccountSummaryInstallmentForMessage,
  index: number,
): string {
  const statusPhrase =
    item.overdueDays > 0
      ? `venció hace ${item.overdueDays} días`
      : item.daysUntilDue > 0
        ? `vence en ${item.daysUntilDue} días`
        : 'vence hoy';

  return (
    `${bulletForIndex(index)} La cuota No. ${item.installmentNumber} del pagaré ` +
    `#${item.promissoryNoteNumber} por $${formatCurrency(item.totalDue)} ${statusPhrase}.`
  );
}

export function calculateAccountSummaryTotal(
  installments: AccountSummaryInstallmentForMessage[],
): number {
  return installments.reduce((sum, item) => sum + item.totalDue, 0);
}

export function renderAccountSummaryMessage(
  templateContent: string,
  clientFullName: string,
  installments: AccountSummaryInstallmentForMessage[],
): string {
  const installmentsList = installments
    .map(renderAccountSummaryInstallmentLine)
    .join('\n');
  const grandTotal = formatCurrency(calculateAccountSummaryTotal(installments));

  return templateContent
    .replaceAll('{{clientFullName}}', clientFullName)
    .replaceAll('{{installmentsList}}', installmentsList)
    .replaceAll('{{grandTotal}}', `$${grandTotal}`);
}
