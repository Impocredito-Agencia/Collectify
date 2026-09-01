import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { Select } from '@/components/ui/Select';
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
import { usePreviewSchedule } from '@/features/loans/useLoans';
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
interface ConceptRow extends LoanConceptAssignment {
  rowId: string;
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

  const count = parseInt(totalInstallments, 10) || 0;
  const canCalculate =
    principalAmount > 0 &&
    count > 0 &&
    disbursedAt !== '' &&
    hasUsableUsuryRate;

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

  const addConceptRow = () => {
    const firstType = corrienteConceptTypes[0];
    setConcepts((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        conceptTypeId: firstType?.id ?? '',
        calculationType:
          firstType?.defaultCalculationType ??
          ConceptCalculationType.Percentage,
        value: firstType?.defaultValue ?? 0,
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
          value,
        })),
      });
      setPreview(result);
    } catch {
      setFormError('No se pudo calcular la cotización. Intenta de nuevo.');
    }
  };

  // Cuota fija (Phase 14 correction) — every installment has the same
  // amount except possibly the last one, which absorbs the rounding
  // remainder. The first installment is the representative "this is what
  // you'd pay" headline number a prospect actually wants to hear.
  const monthlyAmount = preview?.installments[0]?.amount ?? null;
  const totalToPay =
    preview?.installments.reduce(
      (sum, installment) => sum + installment.amount,
      0,
    ) ?? null;

  const frequencyLabel =
    installmentFrequency === InstallmentFrequency.Monthly
      ? 'mensual'
      : 'quincenal';

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Proyector rápido"
        subtitle="Simula un préstamo antes de crearlo — nada aquí queda guardado"
      />

      <div className="border-t border-border" />

      <StaleUsuryRateBanner />

      <div className="grid grid-cols-[420px_1fr] gap-8">
        <div className="flex flex-col gap-3.5 rounded bg-surface p-5">
          <Field label="Monto a financiar">
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
              <select
                value={installmentFrequency}
                onChange={(event) => {
                  setInstallmentFrequency(
                    event.target.value as InstallmentFrequency,
                  );
                  setPreview(null);
                }}
                className={inputClassName}
              >
                <option value={InstallmentFrequency.Monthly}>Mensual</option>
                <option value={InstallmentFrequency.Biweekly}>Quincenal</option>
              </select>
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
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    disabled={
                      row.calculationType === ConceptCalculationType.Percentage
                    }
                    value={
                      row.calculationType === ConceptCalculationType.Percentage
                        ? (currentUsuryRate?.ratePercentage ?? '')
                        : row.value
                    }
                    onChange={(event) =>
                      updateConceptRow(row.rowId, {
                        value: parseFloat(event.target.value) || 0,
                      })
                    }
                    title={
                      row.calculationType === ConceptCalculationType.Percentage
                        ? 'Se aplica la tasa de usura vigente automáticamente — no editable.'
                        : undefined
                    }
                    placeholder={
                      row.calculationType === ConceptCalculationType.Percentage
                        ? '%'
                        : '$'
                    }
                    className="h-9 w-20 rounded border border-border bg-input px-2.5 text-small text-white focus:border-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => removeConceptRow(row.rowId)}
                    className="text-meta text-muted hover:text-red-400"
                  >
                    Quitar
                  </button>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-3">
                <ChipButton onClick={addConceptRow}>
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
            <p className="text-small text-red-400" role="alert">
              {formError}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleCalculate()}
            disabled={!canCalculate || previewSchedule.isPending}
            className="mt-1 rounded bg-white px-4 py-2.5 text-small font-semibold text-background hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {previewSchedule.isPending ? 'Calculando…' : 'Calcular cotización'}
          </button>
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
              <div className="rounded border border-border bg-surface p-10 text-center">
                <p className="text-label text-muted">Cuota {frequencyLabel}</p>
                <p className="mt-2 text-[48px] font-semibold leading-tight text-white">
                  {monthlyAmount !== null ? formatCurrency(monthlyAmount) : '—'}
                </p>
                <p className="mt-3 text-small text-muted">
                  {count} cuota(s) · Total a pagar:{' '}
                  <span className="font-medium text-white">
                    {totalToPay !== null ? formatCurrency(totalToPay) : '—'}
                  </span>
                </p>
              </div>

              <div className="overflow-hidden rounded border border-border bg-surface">
                <table className="w-full border-collapse">
                  <thead className="bg-input">
                    <tr className="divide-x divide-border">
                      <Th>Cuota</Th>
                      <Th>Vence</Th>
                      <Th className="text-right">Capital</Th>
                      <Th className="text-right">Total</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.installments.map((installment) => (
                      <tr
                        key={installment.installmentNumber}
                        className="divide-x divide-border"
                      >
                        <Td>{installment.installmentNumber}</Td>
                        <Td>{formatDateOnly(installment.dueDate)}</Td>
                        <Td className="text-right">
                          {formatCurrency(installment.principalPortion)}
                        </Td>
                        <Td className="text-right font-medium text-white">
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <span className="text-[10px] font-medium tracking-[0.4px] text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

// Same chip treatment as LoanForm.tsx/RefinanceLoanForm.tsx — a bordered,
// backgrounded button instead of bare colored text, which made these easy
// to miss as actual clickable actions.
function ChipButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 self-start rounded border border-border bg-input px-3.5 py-2 text-small text-muted hover:border-subtle hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg
      className="size-3.5 shrink-0"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
    >
      <path d="M10 4v12M4 10h12" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`h-11 px-4 text-left text-label font-medium tracking-[0.36px] text-muted ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`h-12 px-4 text-small text-muted ${className}`}>
      {children}
    </td>
  );
}
