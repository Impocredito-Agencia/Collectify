import { useEffect, useRef, useState } from 'react';

import { DecimalInput } from '@/components/ui/DecimalInput';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { ChipButton } from '@/components/ui/ChipButton';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Field } from '@/components/ui/Field';
import { DatePicker } from '@/components/ui/DatePicker';
import { PlusIcon } from '@/components/ui/PlusIcon';
import { Select } from '@/components/ui/Select';
import { Td, Th } from '@/components/ui/Table';
import { InterestConceptTypeForm } from '@/features/interestConceptTypes/InterestConceptTypeForm';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '@/features/interestConceptTypes/interestConceptTypesApi';
import {
  useCreateInterestConceptType,
  useInterestConceptTypes,
} from '@/features/interestConceptTypes/useInterestConceptTypes';
import { InstallmentFrequency } from '@/features/loans/loansApi';
import { SystemInterestRateRow } from '@/features/loans/MandatoryConceptRow';
import { usePreviewSchedule } from '@/features/loans/useLoans';
import {
  defaultInterestRate,
  exceedsUsuryCeiling,
} from '@/features/loans/usuryCeiling';
import { StaleUsuryRateBanner } from '@/features/usuryRates/StaleUsuryRateBanner';
import { useCurrentUsuryRate } from '@/features/usuryRates/useUsuryRates';
import { formatCurrency, formatDateOnly } from '@/lib/format';

import type {
  LoanConceptAssignment,
  SchedulePreview,
} from '@/features/loans/loansApi';

// "Amortizador proyector" (client's own name for this, from the Phase 14
// requirements meeting) — a walk-in prospect asks "how much would I pay
// for $X over Y months," and whoever is helping them needs to turn the
// screen around and show a clear answer on the spot, before any Loan
// record exists. Confirmed with the human (2026-08-18): this is a pure,
// stateless calculator — nothing here is ever persisted, unlike an actual
// loan. See docs/phases/PHASE_14_INTEREST_CONCEPTS.md "Open question
// carried forward" (now resolved) and docs/phasesClient/PHASE_14_INTEREST_CONCEPTS.md.
//
// Deliberately calls the exact same POST /loans/preview-schedule endpoint
// LoanForm.tsx uses to preview a real loan before creating it — no
// separate "quote" endpoint, no parallel reimplementation of the
// amortization math, so a number shown here can never drift from what an
// actual loan would produce. Open to every authenticated user, not just
// admins (confirmed with the human): this doesn't touch any client data
// and persists nothing, so it carries none of the risk "Crear préstamo"
// does — and the person actually facing a walk-in prospect at the counter
// is just as likely to be a collector as an admin.
//
// No Figma frame exists for this screen — flagged as a gap like every
// other no-frame build in this codebase, per docs/DESIGN_TOKENS.md
// convention.
//
// Redesign, 2026-09-03 — same system-generated corriente interest field as
// LoanForm.tsx/RefinanceLoanForm.tsx, defaulting to and capped at the usury
// ceiling. No moratorio equivalent here (confirmed with the human): this
// tool only ever quotes corriente concepts, see corrienteConceptTypes below.
// `value` is '' while the field is empty (see DecimalInput.tsx) — submit/
// preview validation rejects an empty one before it ever reaches the api.
interface ConceptRow extends Omit<LoanConceptAssignment, 'value'> {
  rowId: string;
  value: number | '';
}

let nextRowId = 0;
function makeRowId(): string {
  nextRowId += 1;
  return `quote-row-${nextRowId}`;
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LoanQuotePage() {
  const [principalAmount, setPrincipalAmount] = useState(0);
  const [totalInstallments, setTotalInstallments] = useState('');
  const [installmentFrequency, setInstallmentFrequency] = useState(
    InstallmentFrequency.Monthly,
  );
  const [disbursedAt, setDisbursedAt] = useState(todayDateString());
  // Redesign, 2026-09-03 — same "cuota inicial" (down payment) concept as
  // LoanForm.tsx/RefinanceLoanForm.tsx, mirrored here purely for display:
  // this tool persists nothing, so there's no submission payload to build
  // — just a synthetic first row prepended to the preview table below
  // (numbering shifted +1), and folded into "Total a pagar".
  const [hasDownPayment, setHasDownPayment] = useState(false);
  const [downPaymentAmount, setDownPaymentAmount] = useState(0);
  const [downPaymentDueDate, setDownPaymentDueDate] = useState('');
  const [concepts, setConcepts] = useState<ConceptRow[]>([]);
  const [showNewConceptTypeForm, setShowNewConceptTypeForm] = useState(false);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: conceptTypes } = useInterestConceptTypes({ isActive: true });
  const createConceptType = useCreateInterestConceptType();
  const previewSchedule = usePreviewSchedule();
  // Phase 24 — POST /loans/preview-schedule now hard-blocks without a
  // current usury rate on file, so this stateless calculator needs the
  // same guard as the real loan-creation forms. See
  // docs/phases/PHASE_24_USURY_MANDATORY.md.
  const { data: currentUsuryRate } = useCurrentUsuryRate();
  const hasUsableUsuryRate = Boolean(
    currentUsuryRate && !currentUsuryRate.isStale,
  );

  // Redesign, 2026-09-03 — same system-generated corriente interest field
  // as LoanForm.tsx/RefinanceLoanForm.tsx (corrienteInterestRate), defaults
  // to a round rate capped at the usury ceiling (see defaultInterestRate,
  // usuryCeiling.ts) and is capped at that ceiling if edited upward. No
  // moratory equivalent here — this tool only quotes corriente concepts,
  // see the comment above
  // corrienteConceptTypes below.
  const [corrienteInterestRate, setCorrienteInterestRate] = useState<
    number | ''
  >('');
  const hasPrefilledInterestRate = useRef(false);
  useEffect(() => {
    if (currentUsuryRate && !hasPrefilledInterestRate.current) {
      hasPrefilledInterestRate.current = true;
      setCorrienteInterestRate(
        defaultInterestRate(currentUsuryRate.ratePercentage),
      );
    }
  }, [currentUsuryRate]);
  const exceedsCeiling = Boolean(
    currentUsuryRate &&
    exceedsUsuryCeiling(corrienteInterestRate, currentUsuryRate.ratePercentage),
  );

  const count = parseInt(totalInstallments, 10) || 0;
  const canCalculate =
    principalAmount > 0 &&
    count > 0 &&
    disbursedAt !== '' &&
    hasUsableUsuryRate &&
    !exceedsCeiling &&
    (!hasDownPayment || (downPaymentAmount > 0 && downPaymentDueDate !== ''));

  // Phase 23 — this tool only quotes corriente concepts; moratory ones
  // always preview at amount 0 (nothing is overdue in a hypothetical), so
  // there's no informational value in exposing them here, unlike
  // LoanForm.tsx where they're actually assigned to a real loan.
  const corrienteConceptTypes = (conceptTypes ?? []).filter(
    (conceptType) => conceptType.category === ConceptCategory.Corriente,
  );
  const conceptTypeOptions = corrienteConceptTypes.map((conceptType) => ({
    value: conceptType.id,
    label: conceptType.name,
  }));

  // Style fix, 2026-09-03 — see LoanForm.tsx's addConceptRow for the full
  // explanation: new rows start unselected instead of defaulting to
  // corrienteConceptTypes[0].
  const addConceptRow = () => {
    if (corrienteConceptTypes.length === 0) {
      return;
    }
    setConcepts((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        conceptTypeId: '',
        calculationType: ConceptCalculationType.Percentage,
        value: 0,
      },
    ]);
  };

  const removeConceptRow = (rowId: string) => {
    setConcepts((prev) => prev.filter((row) => row.rowId !== rowId));
    setPreview(null);
  };

  const updateConceptRow = (rowId: string, changes: Partial<ConceptRow>) => {
    setConcepts((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, ...changes } : row)),
    );
    setPreview(null);
  };

  const handleCalculate = async () => {
    if (!canCalculate) {
      return;
    }
    // Empty value fields are allowed while editing (DecimalInput never
    // forces a 0), but not when calculating.
    if (corrienteInterestRate === '') {
      setFormError('El valor de los intereses corrientes está vacío.');
      return;
    }
    if (concepts.some((row) => row.value === '')) {
      setFormError(
        'Hay un cargo adicional con el valor vacío. Escribe un valor o quita el cargo.',
      );
      return;
    }
    setFormError(null);
    try {
      const result = await previewSchedule.mutateAsync({
        principalAmount,
        disbursedAt,
        installmentFrequency,
        totalInstallments: count,
        concepts: concepts.map(({ conceptTypeId, calculationType, value }) => ({
          conceptTypeId,
          calculationType,
          value: value === '' ? 0 : value,
        })),
        corrienteInterestRate,
      });
      setPreview(result);
    } catch {
      setFormError('No se pudo calcular la cotización. Intenta de nuevo.');
    }
  };

  // Capital fijo, smoothed — the API averages the true declining-balance
  // interest across every installment and rounds it to the nearest
  // $1,000 (see generateSchedule.ts), so every installment.amount is
  // already identical, including the last. Any one of them is a valid
  // headline "cuota" figure.
  const monthlyAmount = preview?.installments[0]?.amount ?? null;
  const totalToPay =
    preview === null
      ? null
      : preview.installments.reduce(
          (sum, installment) => sum + installment.amount,
          0,
        ) + (hasDownPayment ? downPaymentAmount : 0);

  const frequencyLabel =
    installmentFrequency === InstallmentFrequency.Monthly
      ? 'mensual'
      : 'quincenal';

  // 2026-09-05 — same dynamic-column approach as LoanDetailPage's real
  // installments table (see its own comment): derive one column per charge
  // name actually present in the preview instead of hardcoding "Intereses
  // corrientes" + whatever catalog concepts happen to be assigned. No C/M
  // badge here unlike LoanDetailPage's version — this tool only ever quotes
  // corriente concepts (see corrienteConceptTypes above), so every column
  // would carry the same badge with no distinguishing value.
  //
  // Filtered to Corriente only (style cleanup, 2026-09-05, client
  // feedback — "esa columna de intereses moratorios no sirve para nada
  // aquí") — resolveConceptsWithInterest (loans.service.ts) unconditionally
  // adds a system "Intereses moratorios" entry to every schedule it builds,
  // preview included, and a preview's moratory interest is ALWAYS 0 —
  // nothing can be overdue in a hypothetical schedule (see
  // PreviewedInstallment's own comment). That column would read $0 on every
  // single row, always, with no exception — pure noise here, unlike
  // LoanForm/RefinanceLoanForm, where it's worth confirming before really
  // committing to a loan.
  const chargeNames = Array.from(
    new Set(
      (preview?.installments ?? []).flatMap((installment) =>
        installment.conceptBreakdown
          .filter((concept) => concept.category === ConceptCategory.Corriente)
          .map((concept) => concept.name),
      ),
    ),
  );

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Proyector rápido"
        subtitle="Simula un préstamo antes de crearlo — nada aquí queda guardado"
      />

      <div className="border-t border-border" />

      <StaleUsuryRateBanner />

      {/* items-start, 2026-09-05: without it, this grid's default
          align-items: stretch made the left column match the right
          column's height once the schedule table grew tall (many cuotas)
          — and since every standalone <Field> here uses the default
          layout="row" (flex-1 in a *column* flex container), each one then
          stretched vertically to help fill that extra height, opening up
          large gaps between fields that aren't sitting in a horizontal
          row. items-start keeps the left panel sized to its own content
          regardless of how tall the right side gets. */}
      <div className="grid grid-cols-[420px_1fr] gap-8 items-start">
        <div className="flex flex-col gap-3.5 rounded-lg bg-surface p-5">
          {/* Redesign, 2026-09-03 — same "cuota inicial" checkbox as
              LoanForm.tsx, purely for display here: this tool persists
              nothing (see the file's own top comment), so there's no
              submission payload to build — just numbers folded into the
              headline/preview table below. */}
          <div className="flex flex-col gap-3 rounded border border-border bg-input p-3">
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={hasDownPayment}
                onChange={(event) => {
                  setHasDownPayment(event.target.checked);
                  if (!event.target.checked) {
                    setDownPaymentAmount(0);
                    setDownPaymentDueDate('');
                  }
                  setPreview(null);
                }}
                className="size-4 shrink-0 rounded border-border bg-background accent-white"
              />
              <span className="text-control text-white">
                Tiene cuota inicial
              </span>
            </label>

            {hasDownPayment && (
              <div className="flex gap-3">
                <Field label="Valor">
                  <CurrencyInput
                    value={downPaymentAmount}
                    onChange={(value) => {
                      setDownPaymentAmount(value);
                      setPreview(null);
                    }}
                    placeholder="Ej: $1.000.000"
                    className={inputClassName}
                  />
                </Field>
                <Field label="Fecha">
                  <DatePicker
                    value={downPaymentDueDate}
                    onChange={(next) => {
                      setDownPaymentDueDate(next);
                      setPreview(null);
                    }}
                    className={inputClassName}
                  />
                </Field>
              </div>
            )}
          </div>

          <Field label="Capital a financiar">
            <CurrencyInput
              value={principalAmount}
              onChange={(value) => {
                setPrincipalAmount(value);
                setPreview(null);
              }}
              placeholder="Ej: $1.500.000"
              className={inputClassName}
            />
          </Field>

          <div className="flex gap-3">
            <Field label="N° de cuotas">
              <input
                type="number"
                min={1}
                value={totalInstallments}
                onChange={(event) => {
                  setTotalInstallments(event.target.value);
                  setPreview(null);
                }}
                placeholder="Ej: 12"
                className={inputClassName}
              />
            </Field>
            <Field label="Periodicidad">
              <Select
                value={installmentFrequency}
                onChange={(value) => {
                  setInstallmentFrequency(value as InstallmentFrequency);
                  setPreview(null);
                }}
                options={[
                  { value: InstallmentFrequency.Monthly, label: 'Mensual' },
                  { value: InstallmentFrequency.Biweekly, label: 'Quincenal' },
                ]}
              />
            </Field>
          </div>

          <Field label="Fecha estimada de desembolso">
            <DatePicker
              value={disbursedAt}
              onChange={(next) => {
                setDisbursedAt(next);
                setPreview(null);
              }}
              className={inputClassName}
            />
          </Field>

          <Field label="Cargos adicionales">
            <div className="flex flex-col gap-2">
              <SystemInterestRateRow
                name="Intereses corrientes"
                value={corrienteInterestRate}
                onChange={setCorrienteInterestRate}
                exceedsCeiling={exceedsCeiling}
              />
              {concepts.length === 0 && (
                <p className="text-meta text-muted">
                  Sin cargos adicionales — se cotizará solo el capital.
                </p>
              )}
              {concepts.map((row) => (
                <div key={row.rowId} className="flex items-center gap-2">
                  <Select
                    value={row.conceptTypeId}
                    onChange={(conceptTypeId) => {
                      const type = conceptTypes?.find(
                        (c) => c.id === conceptTypeId,
                      );
                      updateConceptRow(row.rowId, {
                        conceptTypeId,
                        calculationType:
                          type?.defaultCalculationType ?? row.calculationType,
                        value: type?.defaultValue ?? row.value,
                      });
                    }}
                    options={conceptTypeOptions}
                    placeholder="Selecciona un cargo"
                    // min-w-0, 2026-09-05: a flex item's default min-width
                    // is "auto" (its content's intrinsic width), which beats
                    // flex-1 — so a long concept name (e.g. "Cargos por
                    // desembolso prioritario") forced this Select wider than
                    // its share of the row instead of truncating, squeezing
                    // the value input and "Quitar" over to the right. min-w-0
                    // lets flex-1 actually shrink it, so the existing
                    // `truncate` on Select's label span can do its job.
                    className="min-w-0 flex-1"
                  />
                  <DecimalInput
                    value={row.value}
                    onChange={(value) => updateConceptRow(row.rowId, { value })}
                    placeholder={
                      row.calculationType === ConceptCalculationType.Percentage
                        ? '%'
                        : '$'
                    }
                    className="h-[38px] w-24 rounded border border-border bg-input px-2.5 text-small text-white focus:border-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => removeConceptRow(row.rowId)}
                    className="w-[42px] shrink-0 text-center text-meta text-muted hover:text-danger"
                  >
                    Quitar
                  </button>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-3">
                <ChipButton
                  onClick={addConceptRow}
                  disabled={corrienteConceptTypes.length === 0}
                  title={
                    corrienteConceptTypes.length === 0
                      ? 'Crea un tipo de cargo primero'
                      : undefined
                  }
                >
                  <PlusIcon />
                  Agregar cargo
                </ChipButton>
                <ChipButton onClick={() => setShowNewConceptTypeForm(true)}>
                  <PlusIcon />
                  Crear nuevo tipo
                </ChipButton>
              </div>
            </div>
          </Field>

          {formError && (
            <p className="text-small text-danger" role="alert">
              {formError}
            </p>
          )}

          <Button
            onClick={() => void handleCalculate()}
            disabled={!canCalculate || previewSchedule.isPending}
            className="mt-1"
          >
            {previewSchedule.isPending ? 'Calculando…' : 'Calcular cotización'}
          </Button>
        </div>

        <div className="flex flex-col gap-5">
          {!preview ? (
            <div className="flex flex-1 items-center justify-center rounded border border-border bg-surface p-14">
              <p className="text-body text-muted">
                Completa el monto y las cuotas, y presiona "Calcular cotización"
                para ver el resultado.
              </p>
            </div>
          ) : (
            <>
              {/* Style cleanup, 2026-09-05 (client feedback) — same subdued
                  accent-bordered treatment as PayoffDialog's "Total a pagar
                  hoy" (border-accent/30 bg-accent/5): this card's number is
                  this tool's whole reason to exist, same role as that other
                  card's total, so it gets the same visual weight instead of
                  the plain border-border/bg-surface every other neutral
                  panel on this page uses. */}
              <div className="rounded-lg border border-accent/30 bg-accent/5 p-10 text-center">
                <p className="text-label text-muted">Cuota {frequencyLabel}</p>
                <p className="mt-2 text-[48px] font-semibold leading-tight text-white">
                  {monthlyAmount !== null ? formatCurrency(monthlyAmount) : '—'}
                </p>
                <p className="mt-3 text-small text-muted">
                  {count + (hasDownPayment ? 1 : 0)} cuota(s) · Total a pagar:{' '}
                  <span className="font-medium text-white">
                    {totalToPay !== null ? formatCurrency(totalToPay) : '—'}
                  </span>
                </p>
              </div>

              {/* Style cleanup, 2026-09-05 (client feedback, round 2 — the
                  previous max-w truncation still cut off "Intereses
                  corrientes" while leaving visible slack elsewhere in the
                  row) — w-full forced this table to exactly the
                  container's width, so auto table-layout redistributed
                  whatever slack existed (this table's total natural
                  content is usually narrower than a desktop-width card)
                  across columns in whatever proportions the browser felt
                  like, independent of each header span's own max-w-[Npx]
                  truncation cap — a column could end up rendered far wider
                  than its truncated header text actually needed, which is
                  exactly the "cut off AND lots of blank space" combo
                  reported. Dropping w-full lets the table shrink-to-fit
                  its real content instead (the normal, un-stretched
                  behavior for an auto-layout table with no explicit
                  width) — every column ends up exactly as wide as its
                  (possibly truncated) content needs, no more. overflow-x-auto
                  on the wrapper (replacing overflow-hidden) is the
                  safety net for the rare loan with enough concepts that
                  the un-stretched table genuinely doesn't fit — same
                  pattern LoanDetailPage's InstallmentsTable already uses
                  for that exact case. */}
              {/* Style cleanup, 2026-09-05 (client feedback, round 4 — "cuenta
                  el espacio total... primero ubica Cuota con el ancho
                  necesario... el resto lo divides por el numero de
                  columnas que falten"). Only Cuota gets a fixed width now,
                  sized just enough for the word "Cuota" to sit centered
                  without being cut (w-20 — px-3.5 padding plus the word
                  itself). table-fixed then gives every OTHER column
                  (Vence, Capital, every concept column, Total) an equal
                  share of whatever space is left — no more individually
                  guessed px widths for Vence/Capital/Total. A long concept
                  name no longer gets truncate+ellipsis+title; it wraps to
                  two centered lines instead (whitespace-normal + break-words
                  + text-center), per explicit instruction: cutting a word
                  off is worse than a taller header row. */}
              <div className="overflow-x-auto rounded border border-border bg-surface">
                <table className="w-full table-fixed border-collapse">
                  <thead className="bg-input">
                    {/* Style cleanup, 2026-09-05 (client feedback, round 5 —
                        "los titulos de cada columna estan mal") — Th
                        hardcodes `text-left` as a base class (unlike Td,
                        which has no default alignment), and a plain
                        `text-center` override in className wasn't beating
                        it in the compiled stylesheet here, so every header
                        stayed left-aligned even though the cells below it
                        were correctly centered. An inline `style` always
                        wins over a class-based utility regardless of
                        stylesheet source order, so headers use that
                        instead of relying on class-order luck. */}
                    {/* Round 6 — the header row's own height (h-8 via
                        `compact`) was sized for one line, so a two-line
                        concept title like "Cargos por desembolso
                        prioritario" pressed right up against the row's top
                        and bottom borders. `height` here is an inline-style
                        override of that h-8, taller ONLY for the header
                        row — the body rows keep their normal compact
                        height. `verticalAlign: 'middle'` (replacing the
                        earlier `align-top` on concept headers) is what
                        actually centers every header — one-line and
                        two-line alike — inside that taller row; align-top
                        was why some titles looked vertically off. */}
                    <tr className="divide-x divide-border">
                      <Th
                        compact
                        className="w-20 whitespace-nowrap"
                        style={{
                          textAlign: 'center',
                          verticalAlign: 'middle',
                          height: '48px',
                        }}
                      >
                        Cuota
                      </Th>
                      <Th
                        compact
                        className="whitespace-nowrap"
                        style={{
                          textAlign: 'center',
                          verticalAlign: 'middle',
                          height: '48px',
                        }}
                      >
                        Vence
                      </Th>
                      <Th
                        compact
                        className="whitespace-nowrap"
                        style={{
                          textAlign: 'center',
                          verticalAlign: 'middle',
                          height: '48px',
                        }}
                      >
                        Capital
                      </Th>
                      {chargeNames.map((name) => (
                        <Th
                          key={name}
                          compact
                          style={{
                            textAlign: 'center',
                            verticalAlign: 'middle',
                            height: '48px',
                          }}
                        >
                          <span className="block whitespace-normal break-words leading-tight">
                            {name}
                          </span>
                        </Th>
                      ))}
                      <Th
                        compact
                        className="whitespace-nowrap"
                        style={{
                          textAlign: 'center',
                          verticalAlign: 'middle',
                          height: '48px',
                        }}
                      >
                        Total
                      </Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {/* See LoanForm.tsx's identical block — a synthetic
                        first row for the down payment, rest renumbered
                        +1. */}
                    {hasDownPayment && (
                      <tr className="divide-x divide-border">
                        <Td compact className="whitespace-nowrap text-center">
                          1
                        </Td>
                        <Td compact className="whitespace-nowrap text-center">
                          {downPaymentDueDate
                            ? formatDateOnly(downPaymentDueDate)
                            : '—'}
                        </Td>
                        <Td compact className="whitespace-nowrap text-center">
                          {formatCurrency(downPaymentAmount)}
                        </Td>
                        {/* A down payment carries no interest/charges of its
                            own — it's a plain installment. */}
                        {chargeNames.map((name) => (
                          <Td key={name} compact muted className="text-center">
                            —
                          </Td>
                        ))}
                        <Td compact className="whitespace-nowrap text-center">
                          {formatCurrency(downPaymentAmount)}
                        </Td>
                      </tr>
                    )}
                    {preview.installments.map((installment) => (
                      <tr
                        key={installment.installmentNumber}
                        className="divide-x divide-border"
                      >
                        <Td compact className="whitespace-nowrap text-center">
                          {installment.installmentNumber +
                            (hasDownPayment ? 1 : 0)}
                        </Td>
                        <Td compact className="whitespace-nowrap text-center">
                          {formatDateOnly(installment.dueDate)}
                        </Td>
                        <Td compact className="whitespace-nowrap text-center">
                          {formatCurrency(installment.principalPortion)}
                        </Td>
                        {chargeNames.map((name) => {
                          const charge = installment.conceptBreakdown.find(
                            (concept) => concept.name === name,
                          );
                          return (
                            <Td
                              key={name}
                              compact
                              muted={!charge}
                              className="text-center"
                            >
                              {charge ? formatCurrency(charge.amount) : '—'}
                            </Td>
                          );
                        })}
                        <Td compact className="whitespace-nowrap text-center">
                          {formatCurrency(installment.amount)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {showNewConceptTypeForm && (
        <InterestConceptTypeForm
          onSubmit={async (input) => {
            const created = await createConceptType.mutateAsync(input);
            setConcepts((prev) => [
              ...prev,
              {
                rowId: makeRowId(),
                conceptTypeId: created.id,
                calculationType: created.defaultCalculationType,
                value: created.defaultValue ?? 0,
              },
            ]);
          }}
          onClose={() => setShowNewConceptTypeForm(false)}
        />
      )}
    </div>
  );
}

const inputClassName =
  'h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none';

// Field now lives in @/components/ui/Field, ChipButton/PlusIcon in
// @/components/ui/ChipButton and @/components/ui/PlusIcon — see
// DESIGN_TOKENS.md's "Component-based centralization" section.

// Local Th/Td removed (style cleanup, 2026-09-02) — this table used
// `h-11 px-4`/`h-12 px-4`, visibly taller/wider-padded rows than every
// other table in the app (`h-[38px] px-3.5`/`h-11 px-3.5`), an
// inconsistency found while auditing every table for typography drift.
// Replaced with the shared Th/Td; see DESIGN_TOKENS.md.
