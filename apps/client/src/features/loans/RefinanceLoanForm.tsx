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
import { InstallmentFrequency } from '@/features/loans/loansApi';
import { SystemInterestRateRow } from '@/features/loans/MandatoryConceptRow';
import {
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
  | 'principalAmount'
  | 'firstDueDate'
  | 'totalInstallments'
  | 'concepts'
  | 'moratoryConcepts'
  | 'coDebtorClientId'
  | 'downPaymentAmount'
  | 'downPaymentDueDate';
type FieldErrors = Partial<Record<FieldName, string>>;

// Same fix as ClientForm.tsx's/LoanForm.tsx's scrollToFirstError, applied
// here 2026-09-05 — this form is exactly as long as LoanForm.tsx (Modal
// has `scroll`), same bug: a validation error near the top was invisible
// once the admin scrolled down to "Refinanciar". Order matches the
// fields' top-to-bottom visual order in the JSX below.
const FIELD_ORDER: FieldName[] = [
  'downPaymentAmount',
  'downPaymentDueDate',
  'principalAmount',
  'totalInstallments',
  'firstDueDate',
  'concepts',
  'moratoryConcepts',
  'coDebtorClientId',
];
const fieldElementId = (name: FieldName) => `refinance-loan-form-field-${name}`;

let nextRowId = 0;
function makeRowId(): string {
  nextRowId += 1;
  return `refi-row-${nextRowId}`;
}

// The API's suggestedPrincipalAmount is the exact payoff figure (capital
// pendiente + interés causado), which almost always carries a few loose
// pesos of fractional interest — pre-filling "Capital renegociado" with
// that raw number produced an oddly precise default like
// "$8.242.222,707" (CurrencyInput assumes whole pesos and doesn't round,
// see its own doc comment). Loans in this business are otherwise always
// quoted/paid in round numbers (same convention as the smoothed cuota
// amortization — see generateSchedule.ts), so the default shown here
// rounds to the nearest one instead — client feedback, 2026-09-04. Still
// fully editable either way.
//
// Narrowed from the nearest thousand to the nearest hundred, 2026-09-08
// (client request, same change as generateSchedule.ts's own
// roundToNearestHundred) — kept in sync with that same convention.
function roundToNearestHundred(amount: number): number {
  return Math.round(amount / 100) * 100;
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
function describeEarlyWindow(installmentNumbers: number[]): string {
  const labels = installmentNumbers.map((number) => `#${number}`);
  const subject =
    labels.length === 1
      ? `La cuota ${labels[0]} vence`
      : `Las cuotas ${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]} vencen`;
  return `${subject} en los próximos 5 días. Aún no vence${labels.length === 1 ? '' : 'n'}, pero su interés se cobra ahora porque al refinanciar se toma como ya causado.`;
}

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
  // Originally Phase 25 — only shown when refinancing with overdue/near-due
  // installments folded interés ya causado into the new principal (see
  // docs/phases/PHASE_25_REFINANCE_OVERDUE.md), since that isn't obvious
  // from the form alone. Generalized 2026-09-04 (client feedback) to gate
  // EVERY refinance, not just that case — see handleFormSubmit's own
  // comment for why. The overdue-specific paragraph inside
  // ConfirmRefinanceDialog still only renders when there's actually
  // something overdue to call out (installmentNumbers non-empty).
  const [showRefinanceConfirm, setShowRefinanceConfirm] = useState(false);

  useEscapeKey(onClose);

  // See LoanForm.tsx's identical helper for the full explanation — called
  // right after each setFieldErrors that can produce a fresh set of errors
  // (validate() failures in handlePreview/handleFormSubmit below, and the
  // server-side rejections in performSubmit's catch block).
  const scrollToFirstError = (errors: FieldErrors) => {
    const firstInvalidField = FIELD_ORDER.find((name) => errors[name]);
    if (!firstInvalidField) {
      return;
    }
    document
      .getElementById(fieldElementId(firstInvalidField))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

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
        setPrincipalAmount(
          roundToNearestHundred(quote.suggestedPrincipalAmount),
        );
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
          const formalInterest =
            quote.payoff.totalInterestOwed - quote.earlyWindowInterest;
          setDescription(
            quote.earlyWindowInterest > 0
              ? `Refinanciación incluye ${formatCurrency(formalInterest)} de interés ya causado y ${formatCurrency(quote.earlyWindowInterest)} de interés de cuotas que vencen en los próximos 5 días.`
              : `Refinanciación incluye ${formatCurrency(formalInterest)} de interés ya causado en cuotas vencidas.`,
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
        Math.max(
          0,
          roundToNearestHundred(refinanceQuote.suggestedPrincipalAmount) -
            value,
        ),
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
  // Surfaced in ConfirmRefinanceDialog for traceability.
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
  // regardless of hasDownPayment. Bug fix, 2026-09-09: only used for the
  // `disbursedAt` record field now — every installment's real due date is
  // anchored on firstDueDate directly (see firstInstallmentDueDate below),
  // since this subtraction is lossy whenever firstDueDate falls on the
  // 29th-31st and the previous month is shorter.
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
      scrollToFirstError(errors);
      return;
    }
    setFieldErrors({});
    setFormError(null);

    try {
      const result = await previewSchedule.mutateAsync({
        principalAmount: principal,
        disbursedAt: computeDisbursedAt(),
        firstInstallmentDueDate: firstDueDate,
        installmentFrequency,
        totalInstallments: count,
        concepts: toConceptAssignments(),
        moratoryConcepts: toMoratoryConceptAssignments(),
        // Bug fix, 2026-09-07 — see LoanForm.tsx's identical comment:
        // `|| undefined` treated an explicit 0% rate as "not set" (0 is
        // falsy in JS), so it silently fell back to the usury ceiling
        // instead of actually creating the loan at 0%.
        corrienteInterestRate:
          corrienteInterestRate === '' ? undefined : corrienteInterestRate,
        moratoryInterestRate:
          moratoryInterestRate === '' ? undefined : moratoryInterestRate,
      });
      setPreview(result);
    } catch {
      setFormError('No se pudo generar la previsualización. Intenta de nuevo.');
    }
  };

  // Runs form validation, then always opens the refinance confirmation
  // (see showRefinanceConfirm above) — performSubmit only ever runs from
  // that dialog's "Sí, refinanciar" now.
  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      scrollToFirstError(errors);
      return;
    }
    setFieldErrors({});

    // Client feedback, 2026-09-04 — this confirmation used to only appear
    // when the refinance was folding in interés ya causado (overdue/near-due
    // installments). Now shows unconditionally: after seeing EditLoanDialog's
    // brief post-creation-editing experiment and deciding against it (see
    // that component's own comment), the client wants every refinance —
    // not just the overdue-interest case — gated behind an explicit "this
    // can't be undone and the client gets notified right now" confirmation,
    // since the actual submit (performSubmit below) both closes out the old
    // loan irreversibly AND sends the new loan's WhatsApp message
    // synchronously, with no draft/undo step in between.
    setShowRefinanceConfirm(true);
  };

  const performSubmit = async () => {
    setIsSubmitting(true);

    try {
      await onSubmit({
        principalAmount: principal,
        disbursedAt: computeDisbursedAt(),
        firstInstallmentDueDate: firstDueDate,
        installmentFrequency,
        totalInstallments: count,
        concepts: toConceptAssignments(),
        moratoryConcepts: toMoratoryConceptAssignments(),
        // Bug fix, 2026-09-07 — see handlePreview's identical comment above.
        corrienteInterestRate:
          corrienteInterestRate === '' ? undefined : corrienteInterestRate,
        moratoryInterestRate:
          moratoryInterestRate === '' ? undefined : moratoryInterestRate,
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
      // Redesign, 2026-09-06 — promissoryNoteNumber is no longer a field on
      // this form (the new loan always keeps the old loan's own number, set
      // server-side), so a 409/pagaré-format rejection can no longer be
      // attributed to a specific field here — surfaced as a generic form
      // error instead. In practice this should be rare: it would only mean
      // a genuine race (another refinance of the same loan landed first).
      if (err instanceof ApiError) {
        setFormError(err.message);
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
        {/* text-muted (not text-mid) — text-mid's #4a4e54 was too dark
            against the surface background to read comfortably; text-muted
            is the same gray used for secondary text everywhere else in the
            app. Also shortened (client feedback, 2026-09-04): same info,
            fewer words. Always "usted", never "vos"/"podés" — standing
            house-style rule (client, 2026-09-04): every user-facing string
            in this app addresses the admin formally. */}
        <p className="mt-2.5 text-meta text-muted">
          Este préstamo pasará a "Refinanciado" y sus cuotas pendientes se
          cancelarán. Se crea uno nuevo con los términos de abajo — el monto ya
          viene precargado con la deuda actual del cliente (capital pendiente +
          interés causado, sin interés futuro), pero puede editarlo. El préstamo
          nuevo conserva el mismo número de pagaré que el actual.
        </p>

        <div className="mt-3.5">
          <StaleUsuryRateBanner />
        </div>

        <div className="mt-5 border-t border-border" />

        <form onSubmit={handleFormSubmit} className="mt-5 flex flex-col gap-6">
          <fieldset className="contents">
            <FormSection title="Datos del crédito">
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
                      id={fieldElementId('downPaymentAmount')}
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
                      id={fieldElementId('downPaymentDueDate')}
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
                  id={fieldElementId('principalAmount')}
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
                <Field
                  label="N° cuotas"
                  error={fieldErrors.totalInstallments}
                  id={fieldElementId('totalInstallments')}
                >
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

              {/* Third pass (client feedback, 2026-09-04 — second pass
                  "lo hiciste demasiado bien", i.e. it now outweighs the
                  rest of the form). Toned back down to the same visual
                  weight as every other filled-in field: each figure sits
                  in an inputClassName-style box (h-[42px], text-control,
                  same as Field/CurrencyInput) instead of StatCard's 18-24px
                  "hero number" treatment, and the header dropped from
                  text-section-label back to text-label. Also split the old
                  single "Capital sugerido" into two figures per the
                  client's own explanation: the exact payoff total (capital
                  + interés, rounded only to the peso — "Capital a
                  refinanciar") next to the one that actually pre-fills
                  "Capital renegociado" below, rounded to the nearest
                  hundred ("Capital sugerido" — see roundToNearestHundred
                  above, narrowed from the nearest thousand 2026-09-08).
                  Before this, "Capital renegociado" silently
                  pre-filled with the raw, oddly-precise payoff figure
                  (e.g. "$8.242.222,707") while this card showed it
                  rounded — the two numbers looked inconsistent for no
                  visible reason. */}
              {refinanceQuote && (
                <div className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
                  <span className="text-label text-muted">
                    Cómo se calculó el monto sugerido
                  </span>

                  <div
                    className={`grid grid-cols-1 gap-3 ${
                      refinanceQuote.earlyWindowInterest > 0
                        ? 'sm:grid-cols-3'
                        : 'sm:grid-cols-2'
                    }`}
                  >
                    <div>
                      <p className="text-[10px] font-normal text-muted">
                        Capital pendiente
                      </p>
                      <p className="mt-1.5 flex h-[42px] items-center rounded border border-border bg-input px-3.5 text-control text-white">
                        {formatCurrency(
                          refinanceQuote.payoff.totalPrincipalOwed,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-normal text-muted">
                        {refinanceQuote.earlyWindowInterest > 0
                          ? 'Interés de cuotas vencidas'
                          : 'Interés causado'}
                      </p>
                      <p className="mt-1.5 flex h-[42px] items-center rounded border border-border bg-input px-3.5 text-control text-white">
                        {formatCurrency(
                          refinanceQuote.payoff.totalInterestOwed -
                            refinanceQuote.earlyWindowInterest,
                        )}
                      </p>
                    </div>
                    {refinanceQuote.earlyWindowInterest > 0 && (
                      <div>
                        <p
                          className="text-[10px] font-normal text-muted"
                          title="Cuotas que aún no vencen pero vencen en los próximos 5 días: su interés se toma como ya causado al refinanciar."
                        >
                          Interés de cuota próxima a vencer
                        </p>
                        <p className="mt-1.5 flex h-[42px] items-center rounded border border-border bg-input px-3.5 text-control text-white">
                          {formatCurrency(refinanceQuote.earlyWindowInterest)}
                        </p>
                      </div>
                    )}
                  </div>

                  {refinanceQuote.earlyWindowInterest > 0 && (
                    <p className="text-[11px] text-muted">
                      {describeEarlyWindow(
                        refinanceQuote.earlyWindowInstallmentNumbers,
                      )}
                    </p>
                  )}

                  {/* "suman" → "=" (client feedback, 2026-09-04): with two
                      figures below now instead of one, "suman" implied
                      both were a sum of the row above, which is only true
                      of "Capital a refinanciar" — "Capital sugerido" is a
                      rounding of THAT number, not a second sum of
                      pendiente+interés. "=" stays accurate for both
                      readings, and the caption below spells out the
                      second relationship explicitly instead of relying on
                      the divider to carry it. */}
                  <div className="flex items-center gap-3">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-meta text-mid">=</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-normal text-muted">
                        Capital a refinanciar
                      </p>
                      <p className="mt-1.5 flex h-[42px] items-center rounded border border-border bg-input px-3.5 text-control text-white">
                        {formatCurrency(
                          refinanceQuote.suggestedPrincipalAmount,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-normal text-muted">
                        Capital sugerido
                      </p>
                      <p className="mt-1.5 flex h-[42px] items-center rounded border border-border bg-input px-3.5 text-control text-white">
                        {formatCurrency(
                          roundToNearestHundred(
                            refinanceQuote.suggestedPrincipalAmount,
                          ),
                        )}
                      </p>
                    </div>
                  </div>

                  <p className="text-meta text-mid">
                    "Capital sugerido" redondea el capital a refinanciar al
                    centenar más cercano — es el valor con el que se precarga
                    "Capital renegociado" más abajo.
                  </p>
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
                  {/* Fixed stale field name (client feedback, 2026-09-04) —
                      said "Monto renegociado", but the field below is
                      labeled "Capital renegociado" (renamed in the
                      2026-09-03 Monto→Capital terminology sweep — this
                      note was missed then). */}
                  Se resta del capital sugerido — el campo "Capital renegociado"
                  (más abajo) sigue siendo editable después. Si este
                  refinanciamiento es solo para abonar a capital, cuente en la
                  Descripción (más abajo) cuánto se abonó — así queda
                  identificable en el pagaré nuevo y en el registro de
                  auditoría.
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
                  id={fieldElementId('firstDueDate')}
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
              <Field
                label="Cargos adicionales"
                error={fieldErrors.concepts}
                id={fieldElementId('concepts')}
              >
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
                        // min-w-0, 2026-09-05 — see LoanQuotePage.tsx's
                        // identical concept-row Select for the full
                        // explanation: flex-1 alone can't shrink a flex item
                        // below its content's intrinsic width, so a long
                        // concept name pushed the value input/"Quitar" out
                        // instead of truncating.
                        className="min-w-0 flex-1"
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
                id={fieldElementId('moratoryConcepts')}
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
                        // min-w-0, 2026-09-05 — see LoanQuotePage.tsx's
                        // identical concept-row Select for the full
                        // explanation: flex-1 alone can't shrink a flex item
                        // below its content's intrinsic width, so a long
                        // concept name pushed the value input/"Quitar" out
                        // instead of truncating.
                        className="min-w-0 flex-1"
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
                <Field
                  label="Codeudor"
                  error={fieldErrors.coDebtorClientId}
                  id={fieldElementId('coDebtorClientId')}
                >
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

      {showRefinanceConfirm && (
        <ConfirmRefinanceDialog
          installmentNumbers={overdueInstallmentNumbers}
          isSubmitting={isSubmitting}
          onCancel={() => setShowRefinanceConfirm(false)}
          onConfirm={() => {
            setShowRefinanceConfirm(false);
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

// Originally Phase 25 (only for the overdue-interest case) — generalized
// 2026-09-04 (client feedback) to gate every refinance. See
// handleFormSubmit's own comment: once EditLoanDialog's brief
// post-creation-editing experiment was reverted, the client wanted a
// loan's numbers treated as genuinely final the moment they're saved, so
// the one remaining door for "I got something wrong" — Refinanciar — now
// always spells out, up front, that this can't be undone and that the new
// loan's WhatsApp message goes out the instant "Sí, refinanciar" is
// clicked (performSubmit calls the same synchronous create+send the
// backend always has — there's no draft step to catch a mistake
// afterward). Styled after DeleteLoanDialog.tsx, the closest existing
// confirmation-on-top-of-a-form pattern in this codebase.
function ConfirmRefinanceDialog({
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
      {installmentNumbers.length > 0 && (
        <p className="mt-2.5 text-small text-white">
          {installmentNumbers.length > 1
            ? `Las cuotas ${formatInstallmentList(installmentNumbers)} están vencidas o próximas a vencer.`
            : `La cuota ${formatInstallmentList(installmentNumbers)} está vencida o próxima a vencer.`}
        </p>
      )}
      <p className="mt-2.5 text-small text-muted">
        El préstamo actual quedará como "Refinanciado": sus cuotas pendientes se
        cancelan y a partir de ahí solo queda como historial — no se podrá
        volver a registrar pagos ni hacer ninguna otra operación sobre él.
      </p>
      <p className="mt-2.5 text-small text-muted">
        El préstamo nuevo queda fijo desde este momento — monto, tasa y cuotas
        ya no se podrán editar después (solo la descripción). Si algo queda mal,
        la única forma de corregirlo es refinanciando de nuevo. Al confirmar, se
        envía de inmediato el mensaje de WhatsApp al cliente con los datos del
        préstamo nuevo. Esta acción no se puede deshacer.
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
