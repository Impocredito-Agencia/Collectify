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
import { useAuth } from '@/features/auth/useAuth';
import { useClient, useClients } from '@/features/clients/useClients';
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
} from '@/features/loans/useLoans';
import { exceedsUsuryCeiling } from '@/features/loans/usuryCeiling';
import { StaleUsuryRateBanner } from '@/features/usuryRates/StaleUsuryRateBanner';
import { useCurrentUsuryRate } from '@/features/usuryRates/useUsuryRates';
import { ApiError } from '@/lib/apiClient';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import { inputClassName } from '@/lib/formStyles';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { Client, ClientDetail } from '@/features/clients/clientsApi';
import type {
  CreateLoanInput,
  LoanConceptAssignment,
  SchedulePreview,
} from '@/features/loans/loansApi';
import type { FormEvent } from 'react';

interface LoanFormProps {
  onSubmit: (input: CreateLoanInput) => Promise<unknown>;
  onClose: () => void;
}

// One row of the "Cargos adicionales" repeater — a LoanConceptAssignment
// plus a client-only id (for React keys / stable row identity as rows are
// added/removed, since two rows could otherwise share the same
// conceptTypeId+value and be indistinguishable to React).
interface ConceptRow extends LoanConceptAssignment {
  rowId: string;
}

type FieldName =
  | 'clientId'
  | 'promissoryNoteNumber'
  | 'principalAmount'
  | 'firstDueDate'
  | 'totalInstallments'
  | 'concepts'
  | 'moratoryConcepts'
  | 'coDebtorClientId'
  | 'downPaymentAmount'
  | 'downPaymentDueDate'
  | 'description';
type FieldErrors = Partial<Record<FieldName, string>>;

// Same fix as ClientForm.tsx's scrollToFirstError, applied here 2026-09-05
// — this form is long enough (Modal has `scroll`) that a validation error
// on a field near the top (e.g. "Cliente") was completely invisible if the
// admin had already scrolled down to "Crear préstamo": nothing visibly
// happened, since fieldErrors were set but the only feedback was an inline
// message on a field that's off-screen. Order matches the fields'
// top-to-bottom visual order in the JSX below.
const FIELD_ORDER: FieldName[] = [
  'clientId',
  'promissoryNoteNumber',
  'downPaymentAmount',
  'downPaymentDueDate',
  'principalAmount',
  'totalInstallments',
  'firstDueDate',
  'concepts',
  'moratoryConcepts',
  'description',
  'coDebtorClientId',
];
const fieldElementId = (name: FieldName) => `loan-form-field-${name}`;

let nextRowId = 0;
function makeRowId(): string {
  nextRowId += 1;
  return `row-${nextRowId}`;
}

// As of Phase 14 (docs/phases/PHASE_14_INTEREST_CONCEPTS.md), the API
// generates the installment schedule from principalAmount,
// totalInstallments, and concepts — this form no longer collects or splits
// installmentAmounts by hand. Concepts apply to every installment for the
// whole term of the loan and cannot vary per installment — set once here,
// at creation.
//
// Redesign, 2026-09-03: the loan's own corriente/moratorio interest is a
// system field (corrienteInterestRate/moratoryInterestRate), not a catalog
// pick — see SystemInterestRateRow below. It replaces both the old
// standalone "Tasa de interés moratorio (%)" input (interestRate) and the
// earlier "mandatory catalog concept" mechanism. interestRate is still
// sent as a fixed 0, since the API keeps it required — see performSubmit.
export function LoanForm({ onSubmit, onClose }: LoanFormProps) {
  const { user } = useAuth();
  // Phase 23 — "los cobradores no miren el amortizador pero sí deben poder
  // crear el crédito": the live preview/breakdown section below is hidden
  // for a collector without the interest_concept_types grant, but they can
  // still pick concepts and submit the form. This mirrors
  // RequirePermission.tsx's check, purely client-side — the backend's
  // preview-schedule endpoint stays open to everyone (same endpoint the
  // standalone /cotizador page uses), see
  // docs/phases/PHASE_23_DYNAMIC_CHARGES.md "Permissions".
  const canViewAmortizador = Boolean(
    user &&
    (user.role === 'admin' || user.modules.includes('interest_concept_types')),
  );

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const { data: clientResults } = useClients({
    search: clientSearch,
    isActive: true,
  });
  // GET /clients (search results) doesn't include creditUsed/creditAvailable/
  // isMoraBlocked — only GET /clients/:id does (computed on read, see
  // ClientsService.findOneDetail). Fetched once a client is picked, to
  // surface cupo/mora-block inline before the admin fills out the rest of
  // the form. See docs/phases/PHASE_10_CLIENT_CAPACITY.md.
  const { data: selectedClientDetail } = useClient(selectedClient?.id ?? '');
  // Drives disabling the rest of the form below — the client caught that
  // leaving everything fillable when we already know upfront it'll be
  // rejected just produces a confusing duplicate error (the inline notice
  // plus the same message again from the failed submit). See
  // docs/phases/PHASE_10_CLIENT_CAPACITY.md.
  const isMoraBlocked = Boolean(selectedClientDetail?.isMoraBlocked);

  const [promissoryNoteNumber, setPromissoryNoteNumber] = useState('');
  // Style cleanup (2026-09-03) — pre-fills with the suggested next #0000
  // number as soon as it loads, but only once (hasPrefilledNumber guards
  // against clobbering it again later — e.g. if this query ever refetches
  // — after the admin may have already edited or cleared the field by
  // hand; it stays fully editable either way). See
  // useNextPromissoryNoteNumber/loansApi.getNextPromissoryNoteNumber.
  const { data: suggestedPromissoryNoteNumber } = useNextPromissoryNoteNumber();
  const hasPrefilledNumber = useRef(false);
  useEffect(() => {
    if (suggestedPromissoryNoteNumber && !hasPrefilledNumber.current) {
      hasPrefilledNumber.current = true;
      setPromissoryNoteNumber(suggestedPromissoryNoteNumber);
    }
  }, [suggestedPromissoryNoteNumber]);
  const [principalAmount, setPrincipalAmount] = useState(0);
  const [firstDueDate, setFirstDueDate] = useState('');
  const [installmentFrequency, setInstallmentFrequency] = useState(
    InstallmentFrequency.Monthly,
  );
  const [totalInstallments, setTotalInstallments] = useState('');
  const [concepts, setConcepts] = useState<ConceptRow[]>([]);
  // Phase 23 — moratory concepts, a separate list from corriente ones
  // above. Never affect the schedule preview — they only
  // take effect once an installment is overdue. See
  // docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
  const [moratoryConcepts, setMoratoryConcepts] = useState<ConceptRow[]>([]);
  // Redesign, 2026-09-03 — the "cuota inicial" (down payment) is now a
  // real, interest-free installment 1 with its own due date, instead of a
  // purely informational figure. Off by default; checking it reveals the
  // amount/date fields, and shifts the schedule's own numbering (and the
  // "Fecha de la primera cuota" label below) by one. The old
  // purely-informational field this replaces is described in
  // docs/phases/PHASE_13_INITIAL_INSTALLMENT.md — superseded.
  const [hasDownPayment, setHasDownPayment] = useState(false);
  const [downPaymentAmount, setDownPaymentAmount] = useState(0);
  const [downPaymentDueDate, setDownPaymentDueDate] = useState('');
  const [description, setDescription] = useState('');

  // Phase 26 — optional codeudor, off by default so the common
  // no-codeudor case doesn't add clutter; checking it reveals the picker
  // below. A codeudor is now an existing Client, searched/selected the
  // same way the loan's own client is above — no more free-typed details.
  // See docs/phasesClient/PHASE_26_CODEBTOR_CLIENT.md.
  const [hasCoDebtor, setHasCoDebtor] = useState(false);
  const [coDebtorClient, setCoDebtorClient] = useState<Client | null>(null);
  const [coDebtorSearch, setCoDebtorSearch] = useState('');
  const { data: coDebtorResults } = useClients(
    { search: coDebtorSearch, isActive: true },
    // QoL — if the admin opens "créalo aquí" in a new tab to create the
    // codeudor, then comes back here, refetch automatically instead of
    // requiring them to retype the search. staleTime: 0 matters too —
    // otherwise refetchOnWindowFocus is a no-op while still under the
    // app-wide 30s staleTime.
    { refetchOnWindowFocus: true, staleTime: 0 },
  );
  const [coDebtorRelationship, setCoDebtorRelationship] = useState('');

  // QoL — never offer the loan's own client as a codeudor candidate, so
  // there's nothing to pick that would only get rejected at submit time.
  const coDebtorSearchResults = (coDebtorResults?.items ?? []).filter(
    (client) => client.id !== selectedClient?.id,
  );

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Which repeater "Crear nuevo tipo" was clicked from — determines the new
  // type's pre-selected category and which list it gets appended to. null
  // = the dialog is closed.
  const [newConceptTypeTarget, setNewConceptTypeTarget] = useState<
    'corriente' | 'moratorio' | null
  >(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);

  useEscapeKey(onClose);

  // Called explicitly right after each `setFieldErrors` that can produce a
  // fresh set of errors (both the client-side validate() below and the
  // server-side rejections in performSubmit's catch block) — not wired up
  // as a useEffect on fieldErrors, since onChange handlers also clear
  // individual field errors as the admin types, and re-scrolling on every
  // one of those would yank the form out from under whatever they're
  // currently fixing. See ClientForm.tsx's identical helper.
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
  // Redesign, 2026-09-03 — corrienteInterestRate/moratoryInterestRate
  // (below) default to this ceiling and can only be edited downward, never
  // above it (validated client-side via exceedsUsuryCeiling, and again
  // server-side). A missing/stale rate still blocks submission entirely
  // (StaleUsuryRateBanner explains why).
  const { data: currentUsuryRate } = useCurrentUsuryRate();
  const hasUsableUsuryRate = Boolean(
    currentUsuryRate && !currentUsuryRate.isStale,
  );
  // Starts empty and pre-fills to the ceiling once, same "only once, stays
  // editable after" guard as suggestedPromissoryNoteNumber above, so it
  // doesn't clobber a value the admin already lowered by hand if this
  // query ever refetches.
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

  const principal = principalAmount;
  const count = parseInt(totalInstallments, 10) || 0;

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

  // Style fix, 2026-09-03 — this used to prefill the new row with
  // corrienteConceptTypes[0], so clicking "Agregar cargo" silently added
  // whichever concept type happened to be first (or re-added the same one
  // already used), instead of prompting the admin to actually choose one.
  // New rows now start unselected (conceptTypeId ''), and the Select below
  // shows a "Selecciona un cargo" placeholder for that state. The button
  // itself is disabled with no concept types at all — see corrienteConceptTypes.length === 0 below.
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

  const handleCountChange = (value: string) => {
    setTotalInstallments(value);
    setFieldErrors((prev) => ({ ...prev, totalInstallments: undefined }));
    setPreview(null);
  };

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!selectedClient) {
      errors.clientId = 'Selecciona un cliente.';
    } else if (isMoraBlocked) {
      // Defensive fallback only — the fieldset/submit button below are
      // disabled whenever this is true, so this normally can't be reached
      // through the UI.
      errors.clientId =
        'Este cliente no puede recibir un nuevo préstamo mientras esté bloqueado por mora.';
    }
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
    // Required (2026-09-04, client request) — this is what the client
    // acquired with the loan (a phone, a TV, a computer...), and it's sent
    // verbatim in the automatic "new loan" WhatsApp message, so a blank
    // value there was never actually harmless.
    if (!description.trim()) {
      errors.description = 'Este campo es obligatorio.';
    }
    if (hasCoDebtor && !coDebtorClient) {
      errors.coDebtorClientId = 'Selecciona un cliente como codeudor.';
    } else if (
      hasCoDebtor &&
      coDebtorClient &&
      selectedClient &&
      coDebtorClient.id === selectedClient.id
    ) {
      errors.coDebtorClientId =
        'El codeudor no puede ser el mismo cliente del préstamo.';
    }
    return errors;
  };

  // firstDueDate always means "the date the schedule's own installment 1
  // (unshifted) is due" — unaffected by hasDownPayment. When there's a
  // down payment it's stored as installment 1 and this schedule installment
  // becomes installment 2 (see the "Fecha de la primera/segunda cuota"
  // label below), but the date math and this field are unchanged either
  // way — the API does the same unshifted-index due-date calculation.
  const computeDisbursedAt = (): string =>
    installmentFrequency === InstallmentFrequency.Monthly
      ? subtractMonthsFromDateString(firstDueDate, 1)
      : subtractDaysFromDateString(firstDueDate, 14);

  // concepts/moratoryConcepts are now purely optional catalog fees — the
  // loan's own corriente/moratorio interest goes through
  // corrienteInterestRate/moratoryInterestRate as top-level fields
  // instead (see performSubmit/handlePreview).
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

  // Redesign, 2026-09-04 (client feedback) — mirrors
  // RefinanceLoanForm.tsx's identical showRefinanceConfirm/performSubmit
  // split (see that file's own comments for the full reasoning). Once
  // EditLoanDialog's brief post-creation-editing experiment was reverted,
  // the client wanted a loan's numbers treated as genuinely final from the
  // moment "Crear préstamo" is clicked — this button used to submit
  // directly. Now it only validates and opens ConfirmCreateLoanDialog;
  // performSubmit (the actual mutation, unchanged below) only ever runs
  // from that dialog's own confirm button.
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);

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
    setShowCreateConfirm(true);
  };

  const performSubmit = async () => {
    setIsSubmitting(true);

    try {
      await onSubmit({
        clientId: selectedClient!.id,
        promissoryNoteNumber,
        principalAmount: principal,
        // corrienteInterestRate/moratoryInterestRate (below) are the
        // loan's real interest now — this legacy field's only remaining
        // use (the pre-Phase-23 fallback for a loan with zero moratory
        // concepts, see enrichInstallment.ts) never applies to a loan
        // created through this form. Still required by the API — sent as
        // a fixed 0 rather than removed there, to avoid a wider migration
        // for a value that no longer does anything for new loans.
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
        description: description.trim(),
        ...(hasCoDebtor && coDebtorClient
          ? {
              coDebtorClientId: coDebtorClient.id,
              ...(coDebtorRelationship.trim()
                ? { coDebtorRelationship: coDebtorRelationship.trim() }
                : {}),
            }
          : {}),
        // Reverted, 2026-09-06 (confirmed with the human) — no longer a
        // checkbox here. This form is "crear préstamo nuevo"; a historical/
        // backfilled loan typed in through it relies on
        // WHATSAPP_SENDING_PAUSED being on for the duration of the backfill
        // to suppress the new-loan message, same as it already relies on
        // for the payment-confirmation messages of each historical cuota
        // registered afterward. Bulk Excel import (LoanImportService) is
        // unaffected — it never sets this field, so it still defaults to
        // false there.
        isNewLoan: true,
      });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.statusCode === 409) {
          const errors: FieldErrors = {
            promissoryNoteNumber: 'Ya existe un préstamo con este número.',
          };
          setFieldErrors(errors);
          scrollToFirstError(errors);
          // Phase 10 guard — LoansService.create() rejects with one of two
          // distinct English messages (see loans.service.ts's
          // assertClientCanTakeNewLoan); matched here and translated,
          // anchored to the field the admin needs to look at.
          // Format check duplicated server-side (@Matches on
          // CreateLoanDto) — normally caught by the client-side check in
          // validate() first, but this covers it too (e.g. a stale form
          // left open across a deploy).
        } else if (err.statusCode === 400 && /pagaré/i.test(err.message)) {
          const errors: FieldErrors = { promissoryNoteNumber: err.message };
          setFieldErrors(errors);
          scrollToFirstError(errors);
        } else if (err.statusCode === 400 && /overdue/i.test(err.message)) {
          const errors: FieldErrors = {
            clientId:
              'Este cliente tiene una cuota con más de 30 días de mora y no puede recibir un nuevo préstamo.',
          };
          setFieldErrors(errors);
          scrollToFirstError(errors);
        } else if (err.statusCode === 400 && /cupo/i.test(err.message)) {
          const errors: FieldErrors = {
            principalAmount: 'El monto supera el cupo disponible del cliente.',
          };
          setFieldErrors(errors);
          scrollToFirstError(errors);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('No se pudo crear el préstamo. Intenta de nuevo.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Widened 560px → 640px, style fix 2026-09-03 — the amortizador
          preview table needed more room to not feel cramped; see the
          table's own comment below. */}
      <Modal maxWidth="max-w-[640px]" scroll>
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-medium text-white">Nuevo préstamo</h2>
          <CloseButton onClick={onClose} />
        </div>
        <p className="mt-1 text-label text-muted">
          Administradores y colaboradores con permiso pueden crear préstamos.
        </p>

        <div className="mt-3.5">
          <StaleUsuryRateBanner />
        </div>

        <div className="mt-5 border-t border-border" />

        <form onSubmit={handleFormSubmit} className="mt-5 flex flex-col gap-6">
          <FormSection title="Cliente">
            <Field
              label="Cliente"
              error={fieldErrors.clientId}
              id={fieldElementId('clientId')}
            >
              {selectedClient ? (
                <div className="flex items-center justify-between rounded border border-border bg-input px-3.5 py-2.5">
                  <span className="text-control text-white">
                    {selectedClient.firstName} {selectedClient.lastName} · CC{' '}
                    {selectedClient.documentNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedClient(null);
                      setFieldErrors((prev) => ({
                        ...prev,
                        clientId: undefined,
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
                    value={clientSearch}
                    onChange={(event) => setClientSearch(event.target.value)}
                    placeholder="Buscar cliente por nombre o cédula…"
                    className={inputClassName(Boolean(fieldErrors.clientId))}
                  />
                  {clientSearch && (clientResults?.items.length ?? 0) > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded border border-border bg-input shadow-lg">
                      {clientResults!.items.slice(0, 5).map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => {
                            setSelectedClient(client);
                            setClientSearch('');
                            setFieldErrors((prev) => ({
                              ...prev,
                              clientId: undefined,
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
                </div>
              )}
            </Field>

            {selectedClient && selectedClientDetail && (
              <ClientCapacityNotice clientDetail={selectedClientDetail} />
            )}
          </FormSection>

          {/* Disabled (not hidden) once the selected client is
              mora-blocked — the client asked for this after seeing the
              alternative: fill out the whole form, hit "Crear préstamo",
              and get the same rejection message a second time at the
              bottom. Nothing here is fillable until a non-blocked client
              is picked instead. */}
          <fieldset disabled={isMoraBlocked} className="contents">
            <FormSection title="Datos del crédito">
              <div className="flex gap-4">
                <Field
                  label="N° de pagaré"
                  error={fieldErrors.promissoryNoteNumber}
                  id={fieldElementId('promissoryNoteNumber')}
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

              {/* Redesign, 2026-09-03 — the down payment ("cuota inicial")
                  checkbox lives here, before capital/cuotas/fecha, per the
                  confirmed flow: marking it reveals its own amount/date,
                  then everything below (capital a financiar, plazo,
                  fecha) describes the remaining, interest-bearing part of
                  the loan. Replaces the old purely-informational
                  "Cuota inicial (opcional)" field that used to live in
                  "Detalles adicionales" — see
                  docs/phases/PHASE_13_INITIAL_INSTALLMENT.md, superseded:
                  that model didn't reflect how a down payment is actually
                  negotiated and collected. */}
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
                    Se cobra sin interés, como la primera cuota del pagaré. El
                    capital y las cuotas de abajo son solo por el resto a
                    financiar.
                  </span>
                )}
              </div>

              <div className="flex gap-4">
                <Field
                  label={hasDownPayment ? 'Capital a financiar' : 'Capital'}
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
                    placeholder="Ej: $1.500.000"
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
                    onChange={(event) => handleCountChange(event.target.value)}
                    placeholder="Ej: 12"
                    className={inputClassName(
                      Boolean(fieldErrors.totalInstallments),
                    )}
                  />
                </Field>
              </div>

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

              {canViewAmortizador && count > 0 && (
                <div className="flex flex-col gap-2.5">
                  <ChipButton
                    onClick={handlePreview}
                    disabled={previewSchedule.isPending || !hasUsableUsuryRate}
                  >
                    {previewSchedule.isPending
                      ? 'Calculando…'
                      : 'Previsualizar cronograma de cuotas'}
                  </ChipButton>
                  {/* Style fix, 2026-09-03 — was a cramped hand-rolled table
                      (no cell borders, text-meta everywhere) inside a
                      second nested box. Now the same Th/Td + grid-line
                      treatment every other table in the app uses (see
                      LoanQuotePage's own preview table), in its own
                      bordered surface instead of double-boxed. Every column
                      uses the default (non-muted) Td — matches how a real
                      data table like LoanRow.tsx colors its columns: only a
                      genuinely decorative index gets `muted`, not amounts or
                      dates that are part of the actual data being shown. */}
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
                            {/* Redesign, 2026-09-03 — the down payment isn't
                                part of this preview response (it has no
                                interest/amortization to compute, see
                                PreviewScheduleInput), so it's rendered here
                                as a synthetic first row, with the schedule's
                                own installments renumbered +1 to match what
                                the API will actually store — mirrors
                                LoansService.persistLoanWithInstallments'
                                own +1 offset exactly. */}
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
              {/* Renamed from "Descripción (opcional)" and made required
                  (2026-09-04, client request) — this is the product the
                  client acquired with the loan (a phone, a TV, a
                  computer...), not a free-form note, and it's sent
                  verbatim as the "Detalle del producto" placeholder in the
                  automatic "new loan" WhatsApp message (see
                  newLoanTemplateSelection.ts on the api side) — a blank
                  value there used to silently fall back to
                  "No especificado" in every outgoing message. */}
              <Field
                label="Producto financiado"
                error={fieldErrors.description}
                id={fieldElementId('description')}
              >
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setFieldErrors((prev) => ({
                      ...prev,
                      description: undefined,
                    }));
                  }}
                  placeholder="Ej: Celular Samsung Galaxy A55, Televisor 55'', Computador portátil…"
                  rows={2}
                  // Not inputClassName(false) — that has a fixed h-[42px] meant
                  // for single-line inputs, which fights with rows={2} and
                  // squeezes the placeholder text with no vertical padding.
                  // py-2.5 instead lets the textarea size itself naturally,
                  // matching MessageTemplateForm.tsx's textarea.
                  className={`w-full resize-none rounded border px-3.5 py-2 text-control text-white placeholder-mid focus:outline-none ${
                    fieldErrors.description
                      ? 'border-danger'
                      : 'border-border focus:border-subtle'
                  } bg-input`}
                />
              </Field>
            </FormSection>

            {/* Phase 26 — optional, off by default. A codeudor is now an
                existing Client, picked via search the same way the loan's
                own client is above — no more free-typed details. See
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
                      setCoDebtorRelationship('');
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
                        {coDebtorSearch &&
                          coDebtorSearchResults.length === 0 && (
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
          </fieldset>

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
              disabled={isSubmitting || isMoraBlocked || !hasUsableUsuryRate}
            >
              {isSubmitting ? 'Creando…' : 'Crear préstamo'}
            </Button>
          </div>
        </form>
      </Modal>

      {showCreateConfirm && (
        <ConfirmCreateLoanDialog
          isSubmitting={isSubmitting}
          onCancel={() => setShowCreateConfirm(false)}
          onConfirm={() => {
            setShowCreateConfirm(false);
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

// Mirrors RefinanceLoanForm.tsx's ConfirmRefinanceDialog — client feedback,
// 2026-09-04: every préstamo's numbers (principalAmount, schedule,
// interestRate, every concept) are fixed the instant it's created, and
// creating one sends the "new loan" WhatsApp message immediately with no
// draft step server-side. So this confirmation, not the form's own submit
// button, is what actually triggers performSubmit — see handleFormSubmit
// above, which only opens this dialog.
function ConfirmCreateLoanDialog({
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEscapeKey(onCancel);

  return (
    <Modal maxWidth="max-w-[420px]">
      <h2 className="text-[16px] font-medium text-white">
        Confirmar creación de préstamo
      </h2>
      <p className="mt-2.5 text-small text-muted">
        Una vez creado, el préstamo queda fijo — monto, tasa y cuotas ya no se
        podrán editar después (solo la descripción). Si algo queda mal, la única
        forma de corregirlo es refinanciando.
      </p>
      <p className="mt-2.5 text-small text-muted">
        Al confirmar, se envía de inmediato el mensaje de WhatsApp al cliente
        con los datos del préstamo. Esta acción no se puede deshacer.
      </p>

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button onClick={onConfirm} disabled={isSubmitting}>
          {isSubmitting ? 'Creando…' : 'Sí, crear préstamo'}
        </Button>
      </div>
    </Modal>
  );
}

// Inline surfacing of the client's cupo/mora-block status once picked —
// mirrors the same rejection reasons the backend would otherwise only
// reveal after submit (see the 400-handling in performSubmit above). Purely
// informational: the backend is still the source of truth and re-checks
// both at submit time regardless of what this shows.
function ClientCapacityNotice({
  clientDetail,
}: {
  clientDetail: ClientDetail;
}) {
  if (clientDetail.isMoraBlocked) {
    return (
      <p
        role="alert"
        className="rounded border border-danger bg-danger-bg px-3.5 py-2.5 text-small text-danger"
      >
        Este cliente tiene una cuota con más de 30 días de mora y no puede
        recibir un nuevo préstamo.
      </p>
    );
  }

  if (clientDetail.creditLimit === null) {
    return null;
  }

  return (
    <p className="text-meta text-muted">
      Cupo disponible: {formatCurrency(clientDetail.creditAvailable ?? 0)} de{' '}
      {formatCurrency(clientDetail.creditLimit)}
    </p>
  );
}

// inputClassName, Field, and FormSection now live in @/lib/formStyles and
// @/components/ui/Field, ChipButton/PlusIcon in @/components/ui/ChipButton
// and @/components/ui/PlusIcon — see DESIGN_TOKENS.md's "Component-based
// centralization" section.
