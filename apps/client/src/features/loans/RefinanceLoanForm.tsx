import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ChipButton } from '@/components/ui/ChipButton';
import { CloseButton } from '@/components/ui/CloseButton';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { Field, FormSection } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PlusIcon } from '@/components/ui/PlusIcon';
import { Select } from '@/components/ui/Select';
import { Td, Th } from '@/components/ui/Table';
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
import {
  InstallmentFrequency,
  PROMISSORY_NOTE_NUMBER_PATTERN,
} from '@/features/loans/loansApi';
import { SystemInterestRateRow } from '@/features/loans/MandatoryConceptRow';
import {
  useNextPromissoryNoteNumber,
  usePreviewSchedule,
  useRefinanceQuote,
} from '@/features/loans/useLoans';
import { exceedsUsuryCeiling } from '@/features/loans/usuryCeiling';
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
  | 'firstDueDate'
  | 'totalInstallments'
  | 'concepts'
  | 'moratoryConcepts'
  | 'coDebtorClientId'
  | 'downPaymentAmount'
  | 'downPaymentDueDate';
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
  // Style cleanup (2026-09-03) — same pre-fill as LoanForm.tsx; see that
  // file's comment for the full reasoning.
  const { data: suggestedPromissoryNoteNumber } = useNextPromissoryNoteNumber();
  const hasPrefilledNumber = useRef(false);
  useEffect(() => {
    if (suggestedPromissoryNoteNumber && !hasPrefilledNumber.current) {
      hasPrefilledNumber.current = true;
      setPromissoryNoteNumber(suggestedPromissoryNoteNumber);
    }
  }, [suggestedPromissoryNoteNumber]);
  const [principalAmount, setPrincipalAmount] = useState(0);
  const [additionalPrincipalPayment, setAdditionalPrincipalPayment] =
    useState(0);
  const [firstDueDate, setFirstDueDate] = useState('');
  const [installmentFrequency, setInstallmentFrequency] = useState(
    InstallmentFrequency.Monthly,
  );
  const [totalInstallments, setTotalInstallments] = useState('');
  const [concepts, setConcepts] = useState<ConceptRow[]>([]);
  // Phase 23 — see LoanForm.tsx's identical field.
  const [moratoryConcepts, setMoratoryConcepts] = useState<ConceptRow[]>([]);
  // Redesign, 2026-09-03 — the new loan created by this refinance can have
  // its own down payment ("cuota inicial"), same as LoanForm.tsx's
  // identical field — confirmed with the human this applies to
  // refinancing too. See that file's own comment for the full reasoning.
  const [hasDownPayment, setHasDownPayment] = useState(false);
  const [downPaymentAmount, setDownPaymentAmount] = useState(0);
  const [downPaymentDueDate, setDownPaymentDueDate] = useState('');
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
  // Phase 24, revised 2026-09-03 (paused pending legal review) — see
  // LoanForm.tsx's identical fields.
  const { data: currentUsuryRate } = useCurrentUsuryRate();
  const hasUsableUsuryRate = Boolean(
    currentUsuryRate && !currentUsuryRate.isStale,
  );
  // corrienteInterestRate/moratoryInterestRate — see LoanForm.tsx's
  // identical fields/effect for the full reasoning.
  const [corrienteInterestRate, setCorrienteInterestRate] = useState<
    number | ''
  >('');
  const [moratoryInterestRate, setMoratoryInterestRate] = useState<number | ''>(
    '',
  );
  const hasPrefilledInterestRates = useRef(false);
  useEffect(() => {
    if (currentUsuryRate && !hasPrefilledInterestRates.current) {
      hasPrefilledInterestRates.current = true;
      setCorrienteInterestRate(currentUsuryRate.ratePercentage);
      setMoratoryInterestRate(currentUsuryRate.ratePercentage);
    }
  }, [currentUsuryRate]);

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
    if (moratoryConceptTypes.length === 0) {
      return;
    }
    setMoratoryConcepts((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        conceptTypeId: '',
        calculationType: ConceptCalculationType.Percentage,
        value: 0,
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
    } else if (
      !PROMISSORY_NOTE_NUMBER_PATTERN.test(promissoryNoteNumber.trim())
    ) {
      errors.promissoryNoteNumber =
        'El número de pagaré debe tener el formato #0000 (ej: #1191).';
    }
    if (!(principal > 0)) {
      errors.principalAmount = 'El monto debe ser mayor a 0.';
    }
    if (!firstDueDate) {
      errors.firstDueDate = hasDownPayment
        ? 'La fecha de la segunda cuota es obligatoria.'
        : 'La fecha de la primera cuota es obligatoria.';
    }
    if (hasDownPayment) {
      if (!(downPaymentAmount > 0)) {
        errors.downPaymentAmount =
          'El valor de la cuota inicial debe ser mayor a 0.';
      }
      if (!downPaymentDueDate) {
        errors.downPaymentDueDate =
          'La fecha de la cuota inicial es obligatoria.';
      } else if (firstDueDate && downPaymentDueDate >= firstDueDate) {
        errors.downPaymentDueDate =
          'La fecha de la cuota inicial debe ser anterior a la fecha de la segunda cuota.';
      }
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
    if (
      currentUsuryRate &&
      exceedsUsuryCeiling(
        corrienteInterestRate,
        currentUsuryRate.ratePercentage,
      )
    ) {
      errors.concepts = `Los intereses corrientes no pueden superar la tasa de usura vigente (${currentUsuryRate.ratePercentage}%).`;
    }
    if (
      currentUsuryRate &&
      exceedsUsuryCeiling(moratoryInterestRate, currentUsuryRate.ratePercentage)
    ) {
      errors.moratoryConcepts = `Los intereses moratorios no pueden superar la tasa de usura vigente (${currentUsuryRate.ratePercentage}%).`;
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

  // See LoanForm.tsx's identical computeDisbursedAt comment — firstDueDate
  // always means the schedule's own unshifted installment 1 date,
  // regardless of hasDownPayment.
  const computeDisbursedAt = (): string =>
    installmentFrequency === InstallmentFrequency.Monthly
      ? subtractMonthsFromDateString(firstDueDate, 1)
      : subtractDaysFromDateString(firstDueDate, 14);

  // See LoanForm.tsx's identical helpers — concepts/moratoryConcepts are
  // now purely optional catalog fees (the refinance-quote pre-fill above
  // never includes the old loan's system-generated interest row, since
  // getRefinanceQuote excludes it — see loans.service.ts). The loan's own
  // corriente/moratorio interest goes through corrienteInterestRate/
  // moratoryInterestRate instead (see performSubmit/handlePreview).
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
        corrienteInterestRate: corrienteInterestRate || undefined,
        moratoryInterestRate: moratoryInterestRate || undefined,
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
        // See LoanForm.tsx's identical comment.
        interestRate: 0,
        disbursedAt: computeDisbursedAt(),
        installmentFrequency,
        totalInstallments: count,
        concepts: toConceptAssignments(),
        moratoryConcepts: toMoratoryConceptAssignments(),
        corrienteInterestRate: corrienteInterestRate || undefined,
        moratoryInterestRate: moratoryInterestRate || undefined,
        ...(hasDownPayment
          ? {
              downPaymentAmount,
              downPaymentDueDate,
            }
          : {}),
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
          // Same format check as LoanForm.tsx's catch block — see its
          // comment. Normally caught client-side first.
        } else if (err.statusCode === 400 && /pagaré/i.test(err.message)) {
          setFieldErrors({ promissoryNoteNumber: err.message });
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
      {/* Widened 560px → 640px, style fix 2026-09-03 — see LoanForm.tsx's
          identical Modal width change. */}
      <Modal maxWidth="max-w-[640px]" scroll>
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
                    placeholder="#0000"
                    className={inputClassName(
                      Boolean(fieldErrors.promissoryNoteNumber),
                    )}
                  />
                </Field>
              </div>

              {/* See LoanForm.tsx's identical block for the full reasoning
                  — same "cuota inicial" checkbox, placed before the
                  renegotiated capital/cuotas/fecha, confirmed to apply to
                  refinancing too. */}
              <div className="flex flex-col gap-3.5 rounded border border-border bg-input p-3">
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
                      setFieldErrors((prev) => ({
                        ...prev,
                        downPaymentAmount: undefined,
                        downPaymentDueDate: undefined,
                      }));
                      setPreview(null);
                    }}
                    className="size-4 shrink-0 rounded border-border bg-background accent-white"
                  />
                  <span className="text-control text-white">
                    Este préstamo tiene cuota inicial
                  </span>
                </label>

                {hasDownPayment && (
                  <div className="flex gap-4">
                    <Field
                      label="Valor de la cuota inicial"
                      error={fieldErrors.downPaymentAmount}
                    >
                      <CurrencyInput
                        value={downPaymentAmount}
                        onChange={(value) => {
                          setDownPaymentAmount(value);
                          setFieldErrors((prev) => ({
                            ...prev,
                            downPaymentAmount: undefined,
                          }));
                        }}
                        placeholder="Ej: $1.000.000"
                        className={inputClassName(
                          Boolean(fieldErrors.downPaymentAmount),
                        )}
                      />
                    </Field>
                    <Field
                      label="Fecha de la cuota inicial"
                      error={fieldErrors.downPaymentDueDate}
                    >
                      <DatePicker
                        value={downPaymentDueDate}
                        onChange={(next) => {
                          setDownPaymentDueDate(next);
                          setFieldErrors((prev) => ({
                            ...prev,
                            downPaymentDueDate: undefined,
                          }));
                        }}
                        className={inputClassName(
                          Boolean(fieldErrors.downPaymentDueDate),
                        )}
                      />
                    </Field>
                  </div>
                )}
                {hasDownPayment && (
                  <span className="text-meta text-muted">
                    Se cobra sin interés, como la primera cuota del pagaré
                    nuevo. El capital renegociado y las cuotas de abajo son solo
                    por el resto a financiar.
                  </span>
                )}
              </div>

              <div className="flex gap-4">
                <Field
                  label="Capital renegociado"
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
                  label={
                    hasDownPayment
                      ? 'Fecha de la segunda cuota'
                      : 'Fecha de la primera cuota'
                  }
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
                  <SystemInterestRateRow
                    name="Intereses corrientes"
                    value={corrienteInterestRate}
                    onChange={setCorrienteInterestRate}
                    exceedsCeiling={
                      currentUsuryRate
                        ? exceedsUsuryCeiling(
                            corrienteInterestRate,
                            currentUsuryRate.ratePercentage,
                          )
                        : false
                    }
                  />
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
                        placeholder="Selecciona un cargo"
                        className="flex-1"
                      />
                      <input
                        type="number"
                        min={0}
                        // step="any" — a percentage concept's value can
                        // carry more decimals than a native step="0.01"
                        // tolerates (see MandatoryConceptRow.tsx's own
                        // comment for the full explanation).
                        step="any"
                        value={row.value}
                        onChange={(event) =>
                          updateConceptRow(row.rowId, {
                            value: parseFloat(event.target.value) || 0,
                          })
                        }
                        placeholder={
                          row.calculationType ===
                          ConceptCalculationType.Percentage
                            ? '%'
                            : '$'
                        }
                        className="h-[38px] w-24 rounded border border-border bg-input px-2.5 text-small text-white focus:border-subtle focus:outline-none"
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
                  <div className="mt-1 flex items-center gap-4">
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
                label="Cargos moratorios"
                error={fieldErrors.moratoryConcepts}
              >
                <div className="flex flex-col gap-2">
                  <SystemInterestRateRow
                    name="Intereses moratorios"
                    value={moratoryInterestRate}
                    onChange={setMoratoryInterestRate}
                    exceedsCeiling={
                      currentUsuryRate
                        ? exceedsUsuryCeiling(
                            moratoryInterestRate,
                            currentUsuryRate.ratePercentage,
                          )
                        : false
                    }
                  />
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
                        placeholder="Selecciona un cargo"
                        className="flex-1"
                      />
                      <input
                        type="number"
                        min={0}
                        // step="any" — a percentage concept's value can
                        // carry more decimals than a native step="0.01"
                        // tolerates (see MandatoryConceptRow.tsx's own
                        // comment for the full explanation).
                        step="any"
                        value={row.value}
                        onChange={(event) =>
                          updateMoratoryConceptRow(row.rowId, {
                            value: parseFloat(event.target.value) || 0,
                          })
                        }
                        placeholder={
                          row.calculationType ===
                          ConceptCalculationType.Percentage
                            ? '%'
                            : '$'
                        }
                        className="h-[38px] w-24 rounded border border-border bg-input px-2.5 text-small text-white focus:border-subtle focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeMoratoryConceptRow(row.rowId)}
                        className="w-[42px] shrink-0 text-center text-meta text-muted hover:text-danger"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                  <div className="mt-1 flex items-center gap-4">
                    <ChipButton
                      onClick={addMoratoryConceptRow}
                      disabled={moratoryConceptTypes.length === 0}
                      title={
                        moratoryConceptTypes.length === 0
                          ? 'Crea un tipo de cargo primero'
                          : undefined
                      }
                    >
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
                <div className="flex flex-col gap-2.5">
                  <ChipButton
                    onClick={handlePreview}
                    disabled={previewSchedule.isPending || !hasUsableUsuryRate}
                  >
                    {previewSchedule.isPending
                      ? 'Calculando…'
                      : 'Previsualizar cronograma de cuotas'}
                  </ChipButton>
                  {/* Style fix, 2026-09-03 — see LoanForm.tsx's identical
                      preview table for the full explanation. */}
                  {preview && (
                    <div className="overflow-hidden rounded border border-border bg-surface">
                      <div className="max-h-[280px] overflow-y-auto">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0 bg-input">
                            <tr className="divide-x divide-border">
                              <Th compact>Cuota</Th>
                              <Th compact>Vence</Th>
                              <Th compact className="text-right">
                                Capital
                              </Th>
                              <Th compact className="text-right">
                                Total
                              </Th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {/* See LoanForm.tsx's identical block — the down
                                payment isn't part of this preview response,
                                so it's rendered as a synthetic first row
                                with the rest renumbered +1. */}
                            {hasDownPayment && (
                              <tr className="divide-x divide-border">
                                <Td compact>1</Td>
                                <Td compact>
                                  {downPaymentDueDate
                                    ? formatDateOnly(downPaymentDueDate)
                                    : '—'}
                                </Td>
                                <Td compact className="text-right">
                                  {formatCurrency(downPaymentAmount)}
                                </Td>
                                <Td compact className="text-right">
                                  {formatCurrency(downPaymentAmount)}
                                </Td>
                              </tr>
                            )}
                            {preview.installments.map((installment) => (
                              <tr
                                key={installment.installmentNumber}
                                className="divide-x divide-border"
                              >
                                <Td compact>
                                  {installment.installmentNumber +
                                    (hasDownPayment ? 1 : 0)}
                                </Td>
                                <Td compact>
                                  {formatDateOnly(installment.dueDate)}
                                </Td>
                                <Td compact className="text-right">
                                  {formatCurrency(installment.principalPortion)}
                                </Td>
                                <Td compact className="text-right">
                                  {formatCurrency(installment.amount)}
                                </Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
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
// @/components/ui/Field, ChipButton/PlusIcon in @/components/ui/ChipButton
// and @/components/ui/PlusIcon — see DESIGN_TOKENS.md's "Component-based
// centralization" section.
