import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { Field, FormSection } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
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
import { InstallmentFrequency } from '@/features/loans/loansApi';
import { MandatoryConceptRow } from '@/features/loans/MandatoryConceptRow';
import { usePreviewSchedule } from '@/features/loans/useLoans';
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
  | 'coDebtorClientId';
type FieldErrors = Partial<Record<FieldName, string>>;

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
// Bug fix, 2026-09-03: the standalone "Tasa de interés moratorio (%)"
// input (interestRate) is gone — every loan now carries a mandatory,
// non-removable moratorio concept instead (MandatoryConceptRow below),
// making that legacy fallback field permanently unreachable for loans
// created through this form. interestRate is still sent as a fixed 0,
// since the API keeps it required — see handleSubmit.
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
  const [principalAmount, setPrincipalAmount] = useState(0);
  const [firstDueDate, setFirstDueDate] = useState('');
  const [installmentFrequency, setInstallmentFrequency] = useState(
    InstallmentFrequency.Monthly,
  );
  const [totalInstallments, setTotalInstallments] = useState('');
  const [concepts, setConcepts] = useState<ConceptRow[]>([]);
  // Phase 23 — moratory concepts, a separate list from corriente ones
  // above. Never affect the schedule preview/level payment — they only
  // take effect once an installment is overdue. See
  // docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
  const [moratoryConcepts, setMoratoryConcepts] = useState<ConceptRow[]>([]);
  // The "cuota inicial" — a down payment the client already made outside
  // the credit system, purely informational and unrelated to the
  // generated schedule. See docs/phases/PHASE_13_INITIAL_INSTALLMENT.md.
  const [initialPayment, setInitialPayment] = useState(0);
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

  const { data: conceptTypes } = useInterestConceptTypes({ isActive: true });
  const createConceptType = useCreateInterestConceptType();
  const previewSchedule = usePreviewSchedule();
  // Phase 24 — a percentage concept's value is always this rate, forced
  // server-side regardless of what's submitted; the row's own input is
  // disabled and shows this instead of being freely typed. A missing/stale
  // rate also blocks submission entirely (StaleUsuryRateBanner explains
  // why). See docs/phases/PHASE_24_USURY_MANDATORY.md.
  const { data: currentUsuryRate } = useCurrentUsuryRate();
  const hasUsableUsuryRate = Boolean(
    currentUsuryRate && !currentUsuryRate.isStale,
  );

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

  // Bug fix, 2026-09-03 — the mandatory, non-removable usury-rate concept
  // per category (docs/phases/PHASE_24_USURY_MANDATORY.md's "Resolved").
  // Always included in the submitted concepts/moratoryConcepts, rendered
  // as a locked row the admin can't remove — see MandatoryConceptRow.
  // undefined when the admin hasn't designated one for that category yet
  // (validate() below blocks submit in that case).
  const mandatoryCorrienteType = corrienteConceptTypes.find(
    (conceptType) => conceptType.isUsuryRateConcept,
  );
  const mandatoryMoratoryType = moratoryConceptTypes.find(
    (conceptType) => conceptType.isUsuryRateConcept,
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
    }
    if (!(principal > 0)) {
      errors.principalAmount = 'El monto debe ser mayor a 0.';
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
    } else if (!mandatoryCorrienteType) {
      errors.concepts =
        'No hay un cargo obligatorio de tasa de usura configurado para cargos corrientes — configúralo en Cargos adicionales.';
    }
    if (moratoryConcepts.some((row) => !row.conceptTypeId)) {
      errors.moratoryConcepts =
        'Selecciona un tipo para cada cargo moratorio agregado.';
    } else if (!mandatoryMoratoryType) {
      errors.moratoryConcepts =
        'No hay un cargo obligatorio de tasa de usura configurado para cargos moratorios — configúralo en Cargos adicionales.';
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

  const computeDisbursedAt = (): string =>
    installmentFrequency === InstallmentFrequency.Monthly
      ? subtractMonthsFromDateString(firstDueDate, 1)
      : subtractDaysFromDateString(firstDueDate, 14);

  // The mandatory concept is prepended here, not held in `concepts` state —
  // it's derived (not user-editable), so this is the one place it needs to
  // exist as a real LoanConceptAssignment for the API. `value` doesn't
  // matter for a percentage concept (forced server-side to the current
  // usury rate regardless) but currentUsuryRate is the best guess to show.
  const toConceptAssignments = (): LoanConceptAssignment[] => [
    ...(mandatoryCorrienteType
      ? [
          {
            conceptTypeId: mandatoryCorrienteType.id,
            calculationType: ConceptCalculationType.Percentage,
            value: currentUsuryRate?.ratePercentage ?? 0,
          },
        ]
      : []),
    ...concepts.map(({ conceptTypeId, calculationType, value }) => ({
      conceptTypeId,
      calculationType,
      value,
    })),
  ];

  const toMoratoryConceptAssignments = (): LoanConceptAssignment[] => [
    ...(mandatoryMoratoryType
      ? [
          {
            conceptTypeId: mandatoryMoratoryType.id,
            calculationType: ConceptCalculationType.Percentage,
            value: currentUsuryRate?.ratePercentage ?? 0,
          },
        ]
      : []),
    ...moratoryConcepts.map(({ conceptTypeId, calculationType, value }) => ({
      conceptTypeId,
      calculationType,
      value,
    })),
  ];

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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setIsSubmitting(true);

    try {
      await onSubmit({
        clientId: selectedClient!.id,
        promissoryNoteNumber,
        principalAmount: principal,
        // Bug fix, 2026-09-03 — the standalone moratory-rate input is gone
        // (see the removed "Tasa de interés moratorio" field below); the
        // mandatory moratorio concept is now always present, so this
        // legacy field's only remaining use (the pre-Phase-23 fallback for
        // a loan with zero moratory concepts, see enrichInstallment.ts)
        // never applies to a loan created through this form. Still
        // required by the API — sent as a fixed 0 rather than removed
        // there, to avoid a wider migration for a value that no longer
        // does anything for new loans.
        interestRate: 0,
        disbursedAt: computeDisbursedAt(),
        installmentFrequency,
        totalInstallments: count,
        concepts: toConceptAssignments(),
        moratoryConcepts: toMoratoryConceptAssignments(),
        initialPayment: initialPayment > 0 ? initialPayment : undefined,
        description: description.trim() || undefined,
        ...(hasCoDebtor && coDebtorClient
          ? {
              coDebtorClientId: coDebtorClient.id,
              ...(coDebtorRelationship.trim()
                ? { coDebtorRelationship: coDebtorRelationship.trim() }
                : {}),
            }
          : {}),
      });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.statusCode === 409) {
          setFieldErrors({
            promissoryNoteNumber: 'Ya existe un préstamo con este número.',
          });
          // Phase 10 guard — LoansService.create() rejects with one of two
          // distinct English messages (see loans.service.ts's
          // assertClientCanTakeNewLoan); matched here and translated,
          // anchored to the field the admin needs to look at.
        } else if (err.statusCode === 400 && /overdue/i.test(err.message)) {
          setFieldErrors({
            clientId:
              'Este cliente tiene una cuota con más de 30 días de mora y no puede recibir un nuevo préstamo.',
          });
        } else if (err.statusCode === 400 && /cupo/i.test(err.message)) {
          setFieldErrors({
            principalAmount: 'El monto supera el cupo disponible del cliente.',
          });
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
      <Modal maxWidth="max-w-[560px]" scroll>
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

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-6">
          <FormSection title="Cliente">
            <Field label="Cliente" error={fieldErrors.clientId}>
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
                    placeholder="Ej: #743"
                    className={inputClassName(
                      Boolean(fieldErrors.promissoryNoteNumber),
                    )}
                  />
                </Field>
              </div>

              <div className="flex gap-4">
                <Field label="Monto" error={fieldErrors.principalAmount}>
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
                <Field label="N° cuotas" error={fieldErrors.totalInstallments}>
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
                  {mandatoryCorrienteType ? (
                    <MandatoryConceptRow
                      name={mandatoryCorrienteType.name}
                      ratePercentage={currentUsuryRate?.ratePercentage}
                    />
                  ) : (
                    <p className="text-meta text-danger">
                      No hay un cargo obligatorio de tasa de usura configurado
                      para cargos corrientes — configúralo en "Tipos de cargo"
                      antes de crear préstamos.
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
                label="Cargos moratorios"
                error={fieldErrors.moratoryConcepts}
              >
                <div className="flex flex-col gap-2">
                  {mandatoryMoratoryType ? (
                    <MandatoryConceptRow
                      name={mandatoryMoratoryType.name}
                      ratePercentage={currentUsuryRate?.ratePercentage}
                    />
                  ) : (
                    <p className="text-meta text-danger">
                      No hay un cargo obligatorio de tasa de usura configurado
                      para cargos moratorios — configúralo en "Tipos de cargo"
                      antes de crear préstamos.
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

              {canViewAmortizador && count > 0 && (
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
              <Field label="Cuota inicial (opcional)">
                <CurrencyInput
                  value={initialPayment}
                  onChange={setInitialPayment}
                  placeholder="Ej: $200.000"
                  className={inputClassName(false)}
                />
                <span className="mt-1 text-meta text-muted">
                  Valor que el cliente ya pagó por fuera del crédito para cubrir
                  parte de la compra — es solo informativo, no hace parte de las
                  cuotas ni afecta el cronograma.
                </span>
              </Field>

              <Field label="Descripción (opcional)">
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Ej: Compra de electrodoméstico…"
                  rows={2}
                  // Not inputClassName(false) — that has a fixed h-[42px] meant
                  // for single-line inputs, which fights with rows={2} and
                  // squeezes the placeholder text with no vertical padding.
                  // py-2.5 instead lets the textarea size itself naturally,
                  // matching MessageTemplateForm.tsx's textarea.
                  className="w-full resize-none rounded border border-border bg-input px-3.5 py-2 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
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

// Inline surfacing of the client's cupo/mora-block status once picked —
// mirrors the same rejection reasons the backend would otherwise only
// reveal after submit (see the 400-handling in handleSubmit above). Purely
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
