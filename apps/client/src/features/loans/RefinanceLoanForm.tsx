import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { Field, FormSection } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useClients } from '@/features/clients/useClients';
import { InterestConceptTypeForm } from '@/features/interestConceptTypes/InterestConceptTypeForm';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '@/features/interestConceptTypes/interestConceptTypesApi';
import {
  useCreateInterestConceptType,
  useInterestConceptTypes,
} from '@/features/interestConceptTypes/useInterestConceptTypes';
import {
  subtractDaysFromDateString,
  subtractMonthsFromDateString,
} from '@/features/loans/dueDateMath';
import { InstallmentFrequency } from '@/features/loans/loansApi';
import {
  usePreviewSchedule,
  useRefinanceQuote,
} from '@/features/loans/useLoans';
import { StaleUsuryRateBanner } from '@/features/usuryRates/StaleUsuryRateBanner';
import { useCurrentUsuryRate } from '@/features/usuryRates/useUsuryRates';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import { inputClassName } from '@/lib/formStyles';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { Client } from '@/features/clients/clientsApi';
import type {
  LoanConceptAssignment,
  RefinanceLoanInput,
  RefinanceQuote,
  SchedulePreview,
} from '@/features/loans/loansApi';
import type { FormEvent } from 'react';

interface RefinanceLoanFormProps {
  oldLoanId: string;
  oldLoanClientId: string;
  oldLoanLabel: string;
  oldLoanOutstandingBalance: number;
  // Phase 26 — the old loan's resolved co-debtor client (from
  // LoanDetail.coDebtorClient) and its standalone relationship field, used
  // to pre-fill this form the same way the backend's own carry-over
  // defaults it. See docs/phasesClient/PHASE_26_CODEBTOR_CLIENT.md.
  oldLoanCoDebtorClient: Client | null;
  oldLoanCoDebtorRelationship: string | null;
  onSubmit: (input: RefinanceLoanInput) => Promise<unknown>;
  onClose: () => void;
}

interface ConceptRow extends LoanConceptAssignment {
  rowId: string;
}

type FieldName =
  | 'promissoryNoteNumber'
  | 'principalAmount'
  | 'interestRate'
  | 'firstDueDate'
  | 'totalInstallments'
  | 'concepts'
  | 'moratoryConcepts'
  | 'coDebtorClientId';
type FieldErrors = Partial<Record<FieldName, string>>;

let nextRowId = 0;
function makeRowId(): string {
  nextRowId += 1;
  return `refi-row-${nextRowId}`;
}

// Mirrors LoanForm.tsx's Phase 14 rewrite exactly (schedule generated from
// principalAmount/totalInstallments/concepts, no more hand-entered
// installmentAmounts) — this is structurally the same operation: create a
// new loan. The only real difference is there's no client selector —
// POST /loans/:id/refinance always attaches the new loan to the same
// client as the one being refinanced, enforced server-side.
//
// Phase 17 (docs/phases/PHASE_17_REFINANCING_RECALC.md) reopens Phase 6's
// "type the exact figure by hand" decision: principalAmount and concepts
// are now pre-filled from GET /loans/:id/refinance-quote, but both stay
// fully editable — the admin keeps final say, exactly as Phase 6 required.
export function RefinanceLoanForm({
  oldLoanId,
  oldLoanClientId,
  oldLoanLabel,
  oldLoanOutstandingBalance,
  oldLoanCoDebtorClient,
  oldLoanCoDebtorRelationship,
  onSubmit,
  onClose,
}: RefinanceLoanFormProps) {
  const [promissoryNoteNumber, setPromissoryNoteNumber] = useState('');
  const [principalAmount, setPrincipalAmount] = useState(0);
  const [additionalPrincipalPayment, setAdditionalPrincipalPayment] =
    useState(0);
  const [interestRate, setInterestRate] = useState('');
  const [firstDueDate, setFirstDueDate] = useState('');
  const [installmentFrequency, setInstallmentFrequency] = useState(
    InstallmentFrequency.Monthly,
  );
  const [totalInstallments, setTotalInstallments] = useState('');
  const [concepts, setConcepts] = useState<ConceptRow[]>([]);
  // Phase 23 — see LoanForm.tsx's identical field.
  const [moratoryConcepts, setMoratoryConcepts] = useState<ConceptRow[]>([]);
  const [description, setDescription] = useState('');

  // Phase 26 — pre-filled from the loan being refinanced
  // (oldLoanCoDebtorClient/oldLoanCoDebtorRelationship) but fully
  // editable, same as the backend's own `dto.field ?? oldLoan.field`
  // carry-over in LoansService#refinance: if the admin leaves these
  // untouched, submitting sends the same values the backend would've
  // defaulted to anyway. The co-debtor is an existing Client, searched
  // and selected the same way as in LoanForm.tsx — no more free-typed
  // details. See docs/phasesClient/PHASE_26_CODEBTOR_CLIENT.md.
  const [hasCoDebtor, setHasCoDebtor] = useState(
    Boolean(oldLoanCoDebtorClient),
  );
  const [coDebtorClient, setCoDebtorClient] = useState<Client | null>(
    oldLoanCoDebtorClient,
  );
  const [coDebtorSearch, setCoDebtorSearch] = useState('');
  const { data: coDebtorResults } = useClients(
    { search: coDebtorSearch, isActive: true },
    // QoL — see LoanForm.tsx's identical call for why both options matter.
    { refetchOnWindowFocus: true, staleTime: 0 },
  );
  const [coDebtorRelationship, setCoDebtorRelationship] = useState(
    oldLoanCoDebtorRelationship ?? '',
  );
  // QoL — never offer the loan's own client as a codeudor candidate, so
  // there's nothing to pick that would only get rejected at submit time.
  const coDebtorSearchResults = (coDebtorResults?.items ?? []).filter(
    (client) => client.id !== oldLoanClientId,
  );

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newConceptTypeTarget, setNewConceptTypeTarget] = useState<
    'corriente' | 'moratorio' | null
  >(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [refinanceQuote, setRefinanceQuote] = useState<RefinanceQuote | null>(
    null,
  );
  // Phase 25 — refinancing with overdue/near-due installments is now
  // allowed (see docs/phases/PHASE_25_REFINANCE_OVERDUE.md), but folding
  // interés ya causado into the new principal isn't obvious from the form
  // alone. A non-zero totalInterestOwed on the quote is exactly the signal
  // that this refinance is including that interest, so gate the actual
  // submit behind one extra confirmation step to avoid it happening by
  // accident/misclick.
  const [showOverdueConfirm, setShowOverdueConfirm] = useState(false);

  useEscapeKey(onClose);

  const { data: conceptTypes } = useInterestConceptTypes({ isActive: true });
  const createConceptType = useCreateInterestConceptType();
  const previewSchedule = usePreviewSchedule();
  const refinanceQuoteMutation = useRefinanceQuote();
  // Phase 24 — see LoanForm.tsx's identical fields.
  const { data: currentUsuryRate } = useCurrentUsuryRate();
  const hasUsableUsuryRate = Boolean(
    currentUsuryRate && !currentUsuryRate.isStale,
  );

  // Pre-fills principalAmount and concepts as soon as the old loan's quote
  // is available — both remain fully editable afterward. A failed fetch
  // just leaves the form blank, same as pre-Phase-17 behavior, so this
  // never blocks refinancing.
  useEffect(() => {
    refinanceQuoteMutation
      .mutateAsync(oldLoanId)
      .then((quote) => {
        setRefinanceQuote(quote);
        setPrincipalAmount(quote.suggestedPrincipalAmount);
        setConcepts(
          quote.concepts.map((concept) => ({
            rowId: makeRowId(),
            ...concept,
          })),
        );
        setMoratoryConcepts(
          quote.moratoryConcepts.map((concept) => ({
            rowId: makeRowId(),
            ...concept,
          })),
        );
        // Phase 25 QoL — when the quote is folding in interés ya causado
        // (overdue/near-due installments), leave a visible paper trail on
        // the new loan's own record, not just in this session's confirm
        // dialog. Pre-filled, still fully editable like every other field
        // this effect sets.
        if (quote.payoff.totalInterestOwed > 0) {
          setDescription(
            `Refinanciación incluye ${formatCurrency(quote.payoff.totalInterestOwed)} de interés ya causado en cuotas vencidas o próximas a vencer.`,
          );
        }
      })
      .catch(() => {
        // Non-fatal — see comment above.
      });
    // Fetch once, when the form opens — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldLoanId]);

  // Recomputes the suggested principal against the loaded quote — the
  // admin can still hand-edit the result afterward via the field itself
  // (confirmed with the human: this is client-side arithmetic only, not a
  // separate backend concept). Clamped at 0 so a paydown larger than the
  // suggested capital can't produce a negative amount.
  const handleAdditionalPrincipalPaymentChange = (value: number) => {
    setAdditionalPrincipalPayment(value);
    if (refinanceQuote) {
      setPrincipalAmount(
        Math.max(0, refinanceQuote.suggestedPrincipalAmount - value),
      );
      setFieldErrors((prev) => ({ ...prev, principalAmount: undefined }));
    }
  };

  const principal = principalAmount;
  const count = parseInt(totalInstallments, 10) || 0;

  // Phase 25 QoL — which specific installments of the old loan are the
  // ones contributing interés ya causado to the new principal (overdue, or
  // within the 5-day early-maturity window). A matured/near-due
  // installment always has interestApplied > 0; one that's genuinely not
  // due yet always has interestApplied === 0 — see calculatePayoff.ts.
  // Surfaced in ConfirmOverdueRefinanceDialog for traceability.
  const overdueInstallmentNumbers = (refinanceQuote?.payoff.installments ?? [])
    .filter((installment) => installment.interestApplied > 0)
    .map((installment) => installment.installmentNumber);

  const corrienteConceptTypes = (conceptTypes ?? []).filter(
    (conceptType) => conceptType.category === ConceptCategory.Corriente,
  );
  const moratoryConceptTypes = (conceptTypes ?? []).filter(
    (conceptType) => conceptType.category === ConceptCategory.Moratorio,
  );
  const conceptTypeOptions = corrienteConceptTypes.map((conceptType) => ({
    value: conceptType.id,
    label: conceptType.name,
  }));
  const moratoryConceptTypeOptions = moratoryConceptTypes.map(
    (conceptType) => ({
      value: conceptType.id,
      label: conceptType.name,
    }),
  );

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
    setFieldErrors((prev) => ({ ...prev, concepts: undefined }));
  };

  const removeConceptRow = (rowId: string) => {
    setConcepts((prev) => prev.filter((row) => row.rowId !== rowId));
  };

  const updateConceptRow = (rowId: string, changes: Partial<ConceptRow>) => {
    setConcepts((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, ...changes } : row)),
    );
    setFieldErrors((prev) => ({ ...prev, concepts: undefined }));
  };

  const addMoratoryConceptRow = () => {
    const firstType = moratoryConceptTypes[0];
    setMoratoryConcepts((prev) => [
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
    setFieldErrors((prev) => ({ ...prev, moratoryConcepts: undefined }));
  };

  const removeMoratoryConceptRow = (rowId: string) => {
    setMoratoryConcepts((prev) => prev.filter((row) => row.rowId !== rowId));
  };

  const updateMoratoryConceptRow = (
    rowId: string,
    changes: Partial<ConceptRow>,
  ) => {
    setMoratoryConcepts((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, ...changes } : row)),
    );
    setFieldErrors((prev) => ({ ...prev, moratoryConcepts: undefined }));
  };

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!promissoryNoteNumber.trim()) {
      errors.promissoryNoteNumber = 'El número de pagaré es obligatorio.';
    }
    if (!(principal > 0)) {
      errors.principalAmount = 'El monto debe ser mayor a 0.';
    }
    const rate = parseFloat(interestRate);
    if (
      interestRate.trim() === '' ||
      Number.isNaN(rate) ||
      rate < 0 ||
      rate > 100
    ) {
      errors.interestRate = 'La tasa debe estar entre 0 y 100.';
    }
    if (!firstDueDate) {
      errors.firstDueDate = 'La fecha de la primera cuota es obligatoria.';
    }
    if (!(count > 0)) {
      errors.totalInstallments = 'El número de cuotas debe ser mayor a 0.';
    }
    if (concepts.some((row) => !row.conceptTypeId)) {
      errors.concepts =
        'Selecciona un tipo para cada cargo adicional agregado.';
    }
    if (moratoryConcepts.some((row) => !row.conceptTypeId)) {
      errors.moratoryConcepts =
        'Selecciona un tipo para cada cargo moratorio agregado.';
    }
    if (hasCoDebtor && !coDebtorClient) {
      errors.coDebtorClientId = 'Selecciona un cliente como codeudor.';
    } else if (
      hasCoDebtor &&
      coDebtorClient &&
      coDebtorClient.id === oldLoanClientId
    ) {
      errors.coDebtorClientId =
        'El codeudor no puede ser el mismo cliente del préstamo.';
    }
    return errors;
  };

  const computeDisbursedAt = (): string =>
    installmentFrequency === InstallmentFrequency.Monthly
      ? subtractMonthsFromDateString(firstDueDate, 1)
      : subtractDaysFromDateString(firstDueDate, 14);

  const toConceptAssignments = (): LoanConceptAssignment[] =>
    concepts.map(({ conceptTypeId, calculationType, value }) => ({
      conceptTypeId,
      calculationType,
      value,
    }));

  const toMoratoryConceptAssignments = (): LoanConceptAssignment[] =>
    moratoryConcepts.map(({ conceptTypeId, calculationType, value }) => ({
      conceptTypeId,
      calculationType,
      value,
    }));

  const handlePreview = async () => {
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setFormError(null);

    try {
      const result = await previewSchedule.mutateAsync({
        principalAmount: principal,
        disbursedAt: computeDisbursedAt(),
        installmentFrequency,
        totalInstallments: count,
        concepts: toConceptAssignments(),
        moratoryConcepts: toMoratoryConceptAssignments(),
      });
      setPreview(result);
    } catch {
      setFormError('No se pudo generar la previsualización. Intenta de nuevo.');
    }
  };

  // Runs form validation, then either opens the overdue-interest
  // confirmation (see showOverdueConfirm above) or goes straight to
  // performSubmit when there's nothing to confirm.
  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    if ((refinanceQuote?.payoff.totalInterestOwed ?? 0) > 0) {
      setShowOverdueConfirm(true);
      return;
    }
    void performSubmit();
  };

  const performSubmit = async () => {
    setIsSubmitting(true);

    try {
      await onSubmit({
        promissoryNoteNumber,
        principalAmount: principal,
        interestRate: parseFloat(interestRate),
        disbursedAt: computeDisbursedAt(),
        installmentFrequency,
        totalInstallments: count,
        concepts: toConceptAssignments(),
        moratoryConcepts: toMoratoryConceptAssignments(),
        description: description.trim() || undefined,
        ...(hasCoDebtor && coDebtorClient
          ? {
              coDebtorClientId: coDebtorClient.id,
              ...(coDebtorRelationship.trim()
                ? { coDebtorRelationship: coDebtorRelationship.trim() }
                : {}),
            }
          : // QoL fix — the old loan had a co-debtor and the admin
            // deliberately unchecked "tiene codeudor": send an explicit
            // null (not just omit) so the backend actually clears it on
            // the new loan instead of silently carrying it over. Omitting
            // is still correct when the old loan never had one.
            oldLoanCoDebtorClient
            ? { coDebtorClientId: null, coDebtorRelationship: null }
            : {}),
      });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.statusCode === 409) {
          setFieldErrors({
            promissoryNoteNumber: 'Ya existe un préstamo con este número.',
          });
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('No se pudo refinanciar el préstamo. Intenta de nuevo.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Modal maxWidth="max-w-[560px]" scroll>
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-medium text-white">
            Refinanciar préstamo
          </h2>
          <CloseButton onClick={onClose} />
        </div>
        <p className="mt-1 text-label text-muted">
          {oldLoanLabel} · Saldo actual:{' '}
          {formatCurrency(oldLoanOutstandingBalance)}
        </p>
        <p className="mt-2.5 text-meta text-mid">
          Este préstamo quedará como "Refinanciado" y sus cuotas pendientes se
          cancelarán. Se crea un préstamo nuevo con los términos de abajo — el
          monto renegociado viene precargado con lo que el cliente realmente
          debe hoy (capital pendiente + interés ya causado, sin cobrar interés
          futuro), pero podés editarlo libremente.
        </p>

        <div className="mt-3.5">
          <StaleUsuryRateBanner />
        </div>

        <div className="mt-5 border-t border-border" />

        <form onSubmit={handleFormSubmit} className="mt-5 flex flex-col gap-6">
          <fieldset className="contents">
            <FormSection title="Datos del crédito">
              <div className="flex gap-4">
                <Field
                  label="N° de pagaré (nuevo)"
                  error={fieldErrors.promissoryNoteNumber}
                >
                  <input
                    value={promissoryNoteNumber}
                    onChange={(event) => {
                      setPromissoryNoteNumber(event.target.value);
                      setFieldErrors((prev) => ({
                        ...prev,
                        promissoryNoteNumber: undefined,
                      }));
                    }}
                    placeholder="Ej: #1000"
                    className={inputClassName(
                      Boolean(fieldErrors.promissoryNoteNumber),
                    )}
                  />
                </Field>
                <Field
                  label="Tasa de interés moratorio (%)"
                  error={fieldErrors.interestRate}
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={interestRate}
                    onChange={(event) => {
                      setInterestRate(event.target.value);
                      setFieldErrors((prev) => ({
                        ...prev,
                        interestRate: undefined,
                      }));
                    }}
                    placeholder="Ej: 6"
                    className={inputClassName(
                      Boolean(fieldErrors.interestRate),
                    )}
                  />
                </Field>
              </div>

              <div className="flex gap-4">
                <Field
                  label="Monto renegociado"
                  error={fieldErrors.principalAmount}
                >
                  <CurrencyInput
                    value={principalAmount}
                    onChange={(value) => {
                      setPrincipalAmount(value);
                      setFieldErrors((prev) => ({
                        ...prev,
                        principalAmount: undefined,
                      }));
                      setPreview(null);
                    }}
                    placeholder="Ej: $950.000"
                    className={inputClassName(
                      Boolean(fieldErrors.principalAmount),
                    )}
                  />
                </Field>
                <Field label="N° cuotas" error={fieldErrors.totalInstallments}>
                  <input
                    type="number"
                    min={1}
                    value={totalInstallments}
                    onChange={(event) => {
                      setTotalInstallments(event.target.value);
                      setFieldErrors((prev) => ({
                        ...prev,
                        totalInstallments: undefined,
                      }));
                      setPreview(null);
                    }}
                    placeholder="Ej: 12"
                    className={inputClassName(
                      Boolean(fieldErrors.totalInstallments),
                    )}
                  />
                </Field>
              </div>

              {refinanceQuote && (
                <div className="rounded border border-border bg-input p-3">
                  <span className="text-meta text-muted">
                    Cómo se calculó el monto sugerido
                  </span>
                  <div className="mt-2 flex items-center justify-between text-meta">
                    <span className="text-muted">Capital pendiente</span>
                    <span className="text-white">
                      {formatCurrency(refinanceQuote.payoff.totalPrincipalOwed)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-meta">
                    <span className="text-muted">Interés causado</span>
                    <span className="text-white">
                      {formatCurrency(refinanceQuote.payoff.totalInterestOwed)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-meta font-medium">
                    <span className="text-muted">Capital sugerido</span>
                    <span className="text-white">
                      {formatCurrency(refinanceQuote.suggestedPrincipalAmount)}
                    </span>
                  </div>
                </div>
              )}

              <Field label="Abono adicional a capital (opcional)">
                <CurrencyInput
                  value={additionalPrincipalPayment}
                  onChange={handleAdditionalPrincipalPaymentChange}
                  placeholder="Ej: $100.000"
                  className={inputClassName(false)}
                />
                <span className="mt-1 text-meta text-muted">
                  Se resta del monto sugerido — el campo "Monto renegociado"
                  sigue siendo editable después. Si este refinanciamiento es
                  solo para abonar a capital, contá en la Descripción (más
                  abajo) cuánto se abonó — así queda identificable en el pagaré
                  nuevo y en el registro de auditoría.
                </span>
              </Field>

              <div className="flex gap-4">
                <Field
                  label="Fecha de la primera cuota"
                  error={fieldErrors.firstDueDate}
                >
                  <DatePicker
                    value={firstDueDate}
                    onChange={(next) => {
                      setFirstDueDate(next);
                      setFieldErrors((prev) => ({
                        ...prev,
                        firstDueDate: undefined,
                      }));
                      setPreview(null);
                    }}
                    className={inputClassName(
                      Boolean(fieldErrors.firstDueDate),
                    )}
                  />
                </Field>
                <Field label="Periodicidad de cuotas">
                  <Select
                    value={installmentFrequency}
                    onChange={(value) => {
                      setInstallmentFrequency(value as InstallmentFrequency);
                      setPreview(null);
                    }}
                    options={[
                      { value: InstallmentFrequency.Monthly, label: 'Mensual' },
                      {
                        value: InstallmentFrequency.Biweekly,
                        label: 'Quincenal',
                      },
                    ]}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Cargos adicionales y cronograma">
              <Field label="Cargos adicionales" error={fieldErrors.concepts}>
                <div className="flex flex-col gap-2">
                  {concepts.length === 0 && (
                    <p className="text-meta text-muted">
                      Sin cargos adicionales — el préstamo se financiará solo
                      con capital. La tasa moratoria de arriba es aparte y solo
                      aplica si una cuota queda vencida.
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
                              type?.defaultCalculationType ??
                              row.calculationType,
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
                          row.calculationType ===
                          ConceptCalculationType.Percentage
                        }
                        value={
                          row.calculationType ===
                          ConceptCalculationType.Percentage
                            ? (currentUsuryRate?.ratePercentage ?? '')
                            : row.value
                        }
                        onChange={(event) =>
                          updateConceptRow(row.rowId, {
                            value: parseFloat(event.target.value) || 0,
                          })
                        }
                        title={
                          row.calculationType ===
                          ConceptCalculationType.Percentage
                            ? 'Se aplica la tasa de usura vigente automáticamente — no editable.'
                            : undefined
                        }
                        placeholder={
                          row.calculationType ===
                          ConceptCalculationType.Percentage
                            ? '%'
                            : '$'
                        }
                        className="h-9 w-24 rounded border border-border bg-input px-2.5 text-small text-white focus:border-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => removeConceptRow(row.rowId)}
                        className="text-meta text-muted hover:text-danger"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                  <div className="mt-1 flex items-center gap-4">
                    <ChipButton onClick={addConceptRow}>
                      <PlusIcon />
                      Agregar cargo
                    </ChipButton>
                    <ChipButton
                      onClick={() => setNewConceptTypeTarget('corriente')}
                    >
                      <PlusIcon />
                      Crear nuevo tipo
                    </ChipButton>
                  </div>
                </div>
              </Field>

              <Field
                label="Cargos moratorios (opcional)"
                error={fieldErrors.moratoryConcepts}
              >
                <div className="flex flex-col gap-2">
                  {moratoryConcepts.length === 0 && (
                    <p className="text-meta text-muted">
                      Sin cargos moratorios — la mora seguirá calculándose con
                      la tasa moratoria de arriba. Si agregás al menos uno acá,
                      esa tasa deja de aplicarse.
                    </p>
                  )}
                  {moratoryConcepts.map((row) => (
                    <div key={row.rowId} className="flex items-center gap-2">
                      <Select
                        value={row.conceptTypeId}
                        onChange={(conceptTypeId) => {
                          const type = conceptTypes?.find(
                            (c) => c.id === conceptTypeId,
                          );
                          updateMoratoryConceptRow(row.rowId, {
                            conceptTypeId,
                            calculationType:
                              type?.defaultCalculationType ??
                              row.calculationType,
                            value: type?.defaultValue ?? row.value,
                          });
                        }}
                        options={moratoryConceptTypeOptions}
                        className="flex-1"
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={
                          row.calculationType ===
                          ConceptCalculationType.Percentage
                        }
                        value={
                          row.calculationType ===
                          ConceptCalculationType.Percentage
                            ? (currentUsuryRate?.ratePercentage ?? '')
                            : row.value
                        }
                        onChange={(event) =>
                          updateMoratoryConceptRow(row.rowId, {
                            value: parseFloat(event.target.value) || 0,
                          })
                        }
                        title={
                          row.calculationType ===
                          ConceptCalculationType.Percentage
                            ? 'Se aplica la tasa de usura vigente automáticamente — no editable.'
                            : undefined
                        }
                        placeholder={
                          row.calculationType ===
                          ConceptCalculationType.Percentage
                            ? '%'
                            : '$'
                        }
                        className="h-9 w-24 rounded border border-border bg-input px-2.5 text-small text-white focus:border-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => removeMoratoryConceptRow(row.rowId)}
                        className="text-meta text-muted hover:text-danger"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                  <div className="mt-1 flex items-center gap-4">
                    <ChipButton onClick={addMoratoryConceptRow}>
                      <PlusIcon />
                      Agregar cargo moratorio
                    </ChipButton>
                    <ChipButton
                      onClick={() => setNewConceptTypeTarget('moratorio')}
                    >
                      <PlusIcon />
                      Crear nuevo tipo
                    </ChipButton>
                  </div>
                </div>
              </Field>

              {count > 0 && (
                <div className="rounded border border-border bg-input p-3">
                  <div className="flex items-center justify-between">
                    <ChipButton
                      onClick={handlePreview}
                      disabled={
                        previewSchedule.isPending || !hasUsableUsuryRate
                      }
                    >
                      {previewSchedule.isPending
                        ? 'Calculando…'
                        : 'Previsualizar cronograma de cuotas'}
                    </ChipButton>
                  </div>
                  {preview && (
                    <div className="mt-2.5 max-h-[180px] overflow-y-auto">
                      <table className="w-full text-meta">
                        <thead>
                          <tr className="text-muted">
                            <th className="pb-1 text-left font-normal">
                              Cuota
                            </th>
                            <th className="pb-1 text-left font-normal">
                              Vence
                            </th>
                            <th className="pb-1 text-right font-normal">
                              Capital
                            </th>
                            <th className="pb-1 text-right font-normal">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.installments.map((installment) => (
                            <tr
                              key={installment.installmentNumber}
                              className="text-white"
                            >
                              <td className="py-0.5">
                                {installment.installmentNumber}
                              </td>
                              <td className="py-0.5">
                                {formatDateOnly(installment.dueDate)}
                              </td>
                              <td className="py-0.5 text-right">
                                {formatCurrency(installment.principalPortion)}
                              </td>
                              <td className="py-0.5 text-right font-medium">
                                {formatCurrency(installment.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </FormSection>

            <FormSection title="Detalles adicionales">
              <Field label="Descripción (opcional)">
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Ej: Refinanciación del pagaré anterior, o Abono a capital de $100.000…"
                  rows={2}
                  className="w-full resize-none rounded border border-border bg-input px-3.5 py-2 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
                />
              </Field>
            </FormSection>
          </fieldset>

          {/* Phase 26 — pre-filled from the loan being refinanced, still
              editable. The codeudor is an existing Client, searched and
              selected the same way as in LoanForm.tsx. See
              docs/phasesClient/PHASE_26_CODEBTOR_CLIENT.md. */}
          <div className="flex flex-col gap-3.5 rounded border border-border bg-input p-3">
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={hasCoDebtor}
                onChange={(event) => {
                  setHasCoDebtor(event.target.checked);
                  if (!event.target.checked) {
                    setCoDebtorClient(null);
                    setCoDebtorSearch('');
                  }
                  setFieldErrors((prev) => ({
                    ...prev,
                    coDebtorClientId: undefined,
                  }));
                }}
                className="size-4 shrink-0 rounded border-border bg-background accent-white"
              />
              <span className="text-control text-white">
                Este préstamo tiene codeudor
              </span>
            </label>

            {hasCoDebtor && (
              <div className="flex flex-col gap-3">
                <Field label="Codeudor" error={fieldErrors.coDebtorClientId}>
                  {coDebtorClient ? (
                    <div className="flex items-center justify-between rounded border border-border bg-input px-3.5 py-2.5">
                      <span className="text-control text-white">
                        {coDebtorClient.firstName} {coDebtorClient.lastName} ·
                        CC {coDebtorClient.documentNumber}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setCoDebtorClient(null);
                          setFieldErrors((prev) => ({
                            ...prev,
                            coDebtorClientId: undefined,
                          }));
                        }}
                        className="text-meta text-muted hover:text-white"
                      >
                        Cambiar
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        value={coDebtorSearch}
                        onChange={(event) =>
                          setCoDebtorSearch(event.target.value)
                        }
                        placeholder="Buscar cliente por nombre o cédula…"
                        className={inputClassName(
                          Boolean(fieldErrors.coDebtorClientId),
                        )}
                      />
                      {coDebtorSearch && coDebtorSearchResults.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full rounded border border-border bg-input shadow-lg">
                          {coDebtorSearchResults.slice(0, 5).map((client) => (
                            <button
                              key={client.id}
                              type="button"
                              onClick={() => {
                                setCoDebtorClient(client);
                                setCoDebtorSearch('');
                                setFieldErrors((prev) => ({
                                  ...prev,
                                  coDebtorClientId: undefined,
                                }));
                              }}
                              className="flex w-full flex-col items-start gap-0.5 px-3.5 py-2 text-left hover:bg-border"
                            >
                              <span className="text-control text-white">
                                {client.firstName} {client.lastName}
                              </span>
                              <span className="text-meta text-muted">
                                CC {client.documentNumber}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      {coDebtorSearch && coDebtorSearchResults.length === 0 && (
                        <p className="mt-2 text-meta text-muted">
                          No se encontró ningún cliente. El codeudor debe
                          existir como cliente primero —{' '}
                          <a
                            href="/clientes"
                            target="_blank"
                            rel="noreferrer"
                            className="text-white underline"
                          >
                            créalo aquí
                          </a>{' '}
                          y luego búscalo de nuevo.
                        </p>
                      )}
                    </div>
                  )}
                </Field>
                <Field label="Relación con el deudor (opcional)">
                  <input
                    value={coDebtorRelationship}
                    onChange={(event) =>
                      setCoDebtorRelationship(event.target.value)
                    }
                    placeholder="Ej: Hermano del deudor"
                    className={inputClassName(false)}
                  />
                </Field>
              </div>
            )}
          </div>

          {formError && (
            <p className="text-small text-danger" role="alert">
              {formError}
            </p>
          )}

          <div className="mt-2.5 border-t border-border" />

          <div className="mt-2 flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !hasUsableUsuryRate}
            >
              {isSubmitting ? 'Refinanciando…' : 'Refinanciar préstamo'}
            </Button>
          </div>
        </form>
      </Modal>

      {showOverdueConfirm && (
        <ConfirmOverdueRefinanceDialog
          installmentNumbers={overdueInstallmentNumbers}
          isSubmitting={isSubmitting}
          onCancel={() => setShowOverdueConfirm(false)}
          onConfirm={() => {
            setShowOverdueConfirm(false);
            void performSubmit();
          }}
        />
      )}

      {newConceptTypeTarget && (
        <InterestConceptTypeForm
          defaultCategory={
            newConceptTypeTarget === 'moratorio'
              ? ConceptCategory.Moratorio
              : ConceptCategory.Corriente
          }
          onSubmit={async (input) => {
            const created = await createConceptType.mutateAsync(input);
            const newRow = {
              rowId: makeRowId(),
              conceptTypeId: created.id,
              calculationType: created.defaultCalculationType,
              value: created.defaultValue ?? 0,
            };
            if (newConceptTypeTarget === 'moratorio') {
              setMoratoryConcepts((prev) => [...prev, newRow]);
            } else {
              setConcepts((prev) => [...prev, newRow]);
            }
          }}
          onClose={() => setNewConceptTypeTarget(null)}
        />
      )}
    </>
  );
}

// Phase 25 — extra confirmation step before a refinance that folds
// interés ya causado (from overdue or within-5-days installments) into
// the new principal, so this doesn't happen from an accidental click on
// "Refinanciar préstamo". Styled after DeleteLoanDialog.tsx, the closest
// existing confirmation-on-top-of-a-form pattern in this codebase.
function ConfirmOverdueRefinanceDialog({
  installmentNumbers,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  installmentNumbers: number[];
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEscapeKey(onCancel);

  return (
    <Modal maxWidth="max-w-[420px]">
      <h2 className="text-[16px] font-medium text-white">
        Confirmar refinanciamiento
      </h2>
      <p className="mt-2.5 text-small text-white">
        {installmentNumbers.length > 1
          ? `Las cuotas ${formatInstallmentList(installmentNumbers)} están vencidas o próximas a vencer.`
          : `La cuota ${formatInstallmentList(installmentNumbers)} está vencida o próxima a vencer.`}
      </p>
      <p className="mt-2.5 text-small text-muted">
        El préstamo actual quedará como "Refinanciado": sus cuotas pendientes se
        cancelan y a partir de ahí solo queda como historial — no se podrá
        volver a registrar pagos ni hacer ninguna otra operación sobre él. Esta
        acción no se puede deshacer.
      </p>

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button onClick={onConfirm} disabled={isSubmitting}>
          {isSubmitting ? 'Refinanciando…' : 'Sí, refinanciar'}
        </Button>
      </div>
    </Modal>
  );
}

// "3", "3 y 4", "3, 4 y 5" — same list style used elsewhere for
// installment numbers in this codebase.
function formatInstallmentList(numbers: number[]): string {
  if (numbers.length <= 1) {
    return numbers.join('');
  }
  return `${numbers.slice(0, -1).join(', ')} y ${numbers[numbers.length - 1]}`;
}

// inputClassName, Field, and FormSection now live in @/lib/formStyles and
// @/components/ui/Field — see DESIGN_TOKENS.md's "Component-based
// centralization" section.

// Same chip treatment ClientForm.tsx's "+ Agregar referencia" fix
// introduced — a bordered, backgrounded button instead of bare colored
// text sitting right next to plain muted body copy, which made it easy to
// miss as an actual clickable action.
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
