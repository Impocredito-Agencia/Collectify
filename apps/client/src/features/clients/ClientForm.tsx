import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ChipButton } from '@/components/ui/ChipButton';
import { CloseButton } from '@/components/ui/CloseButton';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { DatePicker } from '@/components/ui/DatePicker';
import { Field, FormSection } from '@/components/ui/Field';
import { FileUploadField } from '@/components/ui/FileUploadField';
import { Modal } from '@/components/ui/Modal';
import { PlusIcon } from '@/components/ui/PlusIcon';
import { Select } from '@/components/ui/Select';
import {
  ClientReferenceType,
  CLIENT_REFERENCE_TYPE_LABELS,
  DOCUMENT_TYPE_LABELS,
  DocumentType,
  GENDER_LABELS,
  Gender,
} from '@/features/clients/clientsApi';
import {
  useAddClientReference,
  useClient,
  useRemoveClientReference,
  useUpdateClientReference,
} from '@/features/clients/useClients';
import { ApiError } from '@/lib/apiClient';
import { EMAIL_REGEX } from '@/lib/emailPattern';
import { calculateAge } from '@/lib/format';
import { inputClassName } from '@/lib/formStyles';
import { ImageUploadError, uploadDocument } from '@/lib/imageUpload';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type {
  Client,
  ClientReference,
  CreateClientInput,
} from '@/features/clients/clientsApi';
import type { FormEvent } from 'react';

interface ClientFormProps {
  // Present = editing; absent = creating. Matches the two Figma modals
  // (F-11 "Nuevo cliente" / F-12 "Editar cliente"), same layout for both.
  // Only a plain Client is required here (ClientsListPage's edit action
  // only has that, not ClientDetail) — this form fetches the full detail
  // itself below, just for the references list.
  client?: Client;
  onSubmit: (input: CreateClientInput) => Promise<Client>;
  onClose: () => void;
}

type FieldName =
  | 'firstName'
  | 'lastName'
  | 'documentNumber'
  | 'documentType'
  | 'phoneNumber'
  | 'alternatePhoneNumber'
  | 'email'
  | 'address'
  | 'dataProcessingConsent'
  | 'references';
type FieldErrors = Partial<Record<FieldName, string>>;

// Top-to-bottom order the fields actually appear in the form below —
// used only to pick which one to scroll to first when several are
// invalid at once (see the fieldErrors effect further down). Keep this
// in sync with the Field/FormSection order if fields are rearranged.
const FIELD_ORDER: FieldName[] = [
  'firstName',
  'lastName',
  'documentNumber',
  'documentType',
  'phoneNumber',
  'alternatePhoneNumber',
  'email',
  'address',
  'references',
  'dataProcessingConsent',
];

// Element id prefix for each field's wrapper — see the `id` passed to
// each relevant <Field>/section below.
const fieldElementId = (name: FieldName) => `client-form-field-${name}`;

// Mirrors apps/api's CreateClientDto: @IsPhoneNumber('CO') requires a
// Colombian number. This is a client-side approximation (the backend, via
// libphonenumber-js, is the real authority) — good enough to catch the
// obvious mistake of typing a bare local number without +57.
const CO_PHONE_REGEX = /^\+57\d{10}$/;

// No "Sin especificar" option — documentType is required per the client's
// request, so an unselected Select shows the placeholder text passed at
// the call site below instead of offering an explicit "none" choice that
// would immediately trip the required-field validation.
const DOCUMENT_TYPE_OPTIONS = [
  ...Object.values(DocumentType).map((type) => ({
    value: type,
    label: DOCUMENT_TYPE_LABELS[type],
  })),
];

// Unlike documentType above, gender is optional (client request,
// 2026-09-08) — an unselected Select just shows the placeholder text
// below, same as any other optional field in this form.
const GENDER_OPTIONS = [
  ...Object.values(Gender).map((value) => ({
    value,
    label: GENDER_LABELS[value],
  })),
];

// One row of the "Referencias" repeater. `id` is present only for a
// reference that already exists on the server (editing an existing
// client) — its absence is exactly what tells syncReferences below
// whether a row needs POST (new) or PATCH (changed) on submit. `rowId` is
// a client-only key for React identity / stable row order as rows are
// added and removed, same pattern as LoanForm.tsx's ConceptRow.rowId.
interface ReferenceRow {
  rowId: string;
  id?: string;
  type: ClientReferenceType;
  fullName: string;
  phoneNumber: string;
  relationship: string;
}

let nextRowId = 0;
function makeRowId(): string {
  nextRowId += 1;
  return `reference-row-${nextRowId}`;
}

function referenceToRow(reference: ClientReference): ReferenceRow {
  return {
    rowId: makeRowId(),
    id: reference.id,
    type: reference.type,
    fullName: reference.fullName,
    phoneNumber: reference.phoneNumber,
    relationship: reference.relationship,
  };
}

// Phase 3 fields (firstName, lastName, documentNumber, phoneNumber,
// creditLimit) plus the full Phase 21 extended-profile field set — see
// docs/phases/PHASE_21_CLIENT_PROFILE.md for the confirmed list and the
// reasoning behind each decision. Sectioned ("Datos personales",
// "Contacto", "Direcciones", "Referencias", "Documentos", "Autorización")
// per docs/phasesClient/PHASE_21_CLIENT_PROFILE.md, rather than one flat
// list of fields — the form got too long for that once Phase 21 landed.
export function ClientForm({ client, onSubmit, onClose }: ClientFormProps) {
  const isEditing = Boolean(client);

  // Only fetched for its `references` — every other field below is
  // pre-filled straight from the `client` prop, which already carries the
  // full Phase 21 column set (GET /clients returns plain Client rows, not
  // a reduced shape). ClientDetailPage already has this exact query
  // cached (same key), so this is effectively free there; ClientsListPage
  // triggers a real fetch, since its own list view never has references.
  const { data: clientDetail } = useClient(client?.id ?? '');
  const addReference = useAddClientReference();
  const updateReference = useUpdateClientReference();
  const removeReference = useRemoveClientReference();

  const [firstName, setFirstName] = useState(client?.firstName ?? '');
  const [lastName, setLastName] = useState(client?.lastName ?? '');
  const [documentNumber, setDocumentNumber] = useState(
    client?.documentNumber ?? '',
  );
  const [documentType, setDocumentType] = useState(client?.documentType ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(client?.dateOfBirth ?? '');
  const [gender, setGender] = useState(client?.gender ?? '');
  const [documentIssuePlace, setDocumentIssuePlace] = useState(
    client?.documentIssuePlace ?? '',
  );
  const [documentIssueDate, setDocumentIssueDate] = useState(
    client?.documentIssueDate ?? '',
  );
  const [occupation, setOccupation] = useState(client?.occupation ?? '');
  const [employerName, setEmployerName] = useState(client?.employerName ?? '');
  const [monthlyIncome, setMonthlyIncome] = useState(
    client?.monthlyIncome ?? 0,
  );
  // 0 means "no cupo set" per CurrencyInput's own empty-value convention —
  // matches creditLimit being omitted/undefined on submit below. See
  // docs/phases/PHASE_10_CLIENT_CAPACITY.md.
  const [creditLimit, setCreditLimit] = useState(client?.creditLimit ?? 0);

  const [phoneNumber, setPhoneNumber] = useState(client?.phoneNumber ?? '');
  const [alternatePhoneNumber, setAlternatePhoneNumber] = useState(
    client?.alternatePhoneNumber ?? '',
  );
  const [email, setEmail] = useState(client?.email ?? '');

  const [homeAddress, setHomeAddress] = useState(client?.homeAddress ?? '');
  const [workAddress, setWorkAddress] = useState(client?.workAddress ?? '');
  const [city, setCity] = useState(client?.city ?? '');

  const [referenceRows, setReferenceRows] = useState<ReferenceRow[]>(
    () => clientDetail?.references.map(referenceToRow) ?? [],
  );
  // Tracks whether referenceRows was ever initialized from a loaded
  // clientDetail — without this, the useState initializer above only runs
  // once on mount, before the useClient fetch resolves, so an editing
  // client's existing references would silently start out empty. Simpler
  // than a useEffect + loading branch for what's otherwise a one-time
  // hydration.
  const [referencesHydrated, setReferencesHydrated] = useState(
    Boolean(clientDetail),
  );
  if (clientDetail && !referencesHydrated) {
    setReferenceRows(clientDetail.references.map(referenceToRow));
    setReferencesHydrated(true);
  }

  const [idDocumentFrontFile, setIdDocumentFrontFile] = useState<File | null>(
    null,
  );
  const [idDocumentBackFile, setIdDocumentBackFile] = useState<File | null>(
    null,
  );
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [consentDocumentFile, setConsentDocumentFile] = useState<File | null>(
    null,
  );

  // Required, form-level — see docs/phasesClient/PHASE_21_CLIENT_PROFILE.md:
  // "a required checkbox... that must be checked before the form can be
  // submitted". The backend only enforces this on the interactive create
  // path (Excel imports are exempt, ClientsService.create's
  // requireConsent option) — this form applies the same rule to editing
  // too, as a safety net, since ImportClientsDialog.tsx never uses this
  // form at all and is unaffected either way.
  const [dataProcessingConsent, setDataProcessingConsent] = useState(
    client?.dataProcessingConsent ?? false,
  );

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEscapeKey(onClose);

  // Jumps to whichever invalid field appears first in the form —
  // without this, a validation failure on a field near the top (e.g.
  // "Tipo de documento") was completely silent if the admin had already
  // scrolled down to "Guardar cliente": nothing visibly happened, since
  // the only feedback was an inline message on a field that's off-screen.
  // Called explicitly right after `setFieldErrors` at each spot in
  // handleSubmit below that can produce a fresh set of errors — NOT
  // wired up as a useEffect on fieldErrors, since onChange handlers also
  // clear individual field errors as the admin types (see
  // updateReferenceRow etc.), and re-scrolling on every one of those
  // would yank the page out from under whatever they're currently fixing.
  const scrollToFirstError = (errors: FieldErrors) => {
    const firstInvalidField = FIELD_ORDER.find((name) => errors[name]);
    if (!firstInvalidField) {
      return;
    }
    document
      .getElementById(fieldElementId(firstInvalidField))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const addReferenceRow = () => {
    setReferenceRows((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        type: ClientReferenceType.Personal,
        fullName: '',
        phoneNumber: '',
        relationship: '',
      },
    ]);
    setFieldErrors((prev) => ({ ...prev, references: undefined }));
  };

  const updateReferenceRow = (
    rowId: string,
    changes: Partial<ReferenceRow>,
  ) => {
    setReferenceRows((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, ...changes } : row)),
    );
    setFieldErrors((prev) => ({ ...prev, references: undefined }));
  };

  const removeReferenceRow = (rowId: string) => {
    setReferenceRows((prev) => prev.filter((row) => row.rowId !== rowId));
  };

  // Mirrors CreateClientDto's validators client-side, so obvious mistakes
  // are caught before hitting the API — required by Phase 3 scope, plus
  // the Phase 21 consent checkbox and reference row completeness.
  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};

    if (!firstName.trim()) {
      errors.firstName = 'El nombre es obligatorio.';
    }
    if (!lastName.trim()) {
      errors.lastName = 'El apellido es obligatorio.';
    }
    if (!documentNumber.trim()) {
      errors.documentNumber = 'La cédula es obligatoria.';
    }
    if (!documentType) {
      errors.documentType = 'El tipo de documento es obligatorio.';
    }
    if (!phoneNumber.trim()) {
      errors.phoneNumber = 'El celular es obligatorio.';
    } else if (!CO_PHONE_REGEX.test(phoneNumber.trim())) {
      errors.phoneNumber =
        'Debe ser un número colombiano válido, ej: +573001234567.';
    }
    // Optional — unlike phoneNumber above, an empty alternatePhoneNumber
    // is fine. But if the admin does fill it in, hold it to the same
    // Colombian-number format for consistency (per client feedback —
    // previously any text was accepted here).
    if (
      alternatePhoneNumber.trim() &&
      !CO_PHONE_REGEX.test(alternatePhoneNumber.trim())
    ) {
      errors.alternatePhoneNumber =
        'Debe ser un número colombiano válido, ej: +573001234567.';
    }
    // Optional, same treatment as alternatePhoneNumber above — see
    // EMAIL_REGEX's own comment for why this replaced the old bare
    // `type="email"` native check.
    if (email.trim() && !EMAIL_REGEX.test(email.trim())) {
      errors.email = 'Debe ser un correo electrónico válido.';
    }
    // Phase 26 — at least one address is required, matching
    // ClientsService.create()'s backend rule. Neither field is
    // individually required; the pair is, so both share one error key.
    if (!homeAddress.trim() && !workAddress.trim()) {
      errors.address =
        'Debes registrar al menos una dirección (de residencia o de trabajo).';
    }
    if (!dataProcessingConsent) {
      errors.dataProcessingConsent =
        'El cliente debe autorizar el tratamiento de datos personales antes de guardar.';
    }
    if (
      referenceRows.some(
        (row) =>
          !row.fullName.trim() ||
          !row.phoneNumber.trim() ||
          !row.relationship.trim(),
      )
    ) {
      errors.references =
        'Completa nombre, teléfono y relación de cada referencia agregada, o quítala.';
    } else if (
      // Same format check as alternatePhoneNumber — every row is already
      // required to have SOME phone number (checked above); this just
      // holds whatever they typed to the same Colombian format.
      referenceRows.some(
        (row) =>
          row.phoneNumber.trim() &&
          !CO_PHONE_REGEX.test(row.phoneNumber.trim()),
      )
    ) {
      errors.references =
        'El teléfono de una de las referencias no tiene un formato colombiano válido, ej: +573001234567.';
    }

    return errors;
  };

  // Uploads whichever of the four optional files were picked, in
  // parallel — independent uploads, no reason to serialize them. Returns
  // undefined for a slot that has neither a new file nor an existing URL
  // (matches CreateClientInput's "omit the field" convention for unset
  // optional data), or the existing URL unchanged if no replacement was
  // picked.
  const uploadPendingFiles = async (): Promise<{
    idDocumentFrontUrl?: string;
    idDocumentBackUrl?: string;
    selfieImageUrl?: string;
    consentDocumentUrl?: string;
  }> => {
    const resolveSlot = (
      file: File | null,
      existingUrl: string | null | undefined,
    ): Promise<string | undefined> =>
      file ? uploadDocument(file) : Promise.resolve(existingUrl ?? undefined);

    const [
      idDocumentFrontUrl,
      idDocumentBackUrl,
      selfieImageUrl,
      consentDocumentUrl,
    ] = await Promise.all([
      resolveSlot(idDocumentFrontFile, client?.idDocumentFrontUrl),
      resolveSlot(idDocumentBackFile, client?.idDocumentBackUrl),
      resolveSlot(selfieFile, client?.selfieImageUrl),
      resolveSlot(consentDocumentFile, client?.consentDocumentUrl),
    ]);
    return {
      idDocumentFrontUrl,
      idDocumentBackUrl,
      selfieImageUrl,
      consentDocumentUrl,
    };
  };

  // Diffs referenceRows against the references clientDetail actually had
  // when the form opened, and fires only the calls needed to reconcile
  // them — added rows (no `id`) → addReference, changed rows →
  // updateReference, rows present in the original set but no longer in
  // referenceRows → removeReference. Runs after the client itself is
  // successfully saved, since a brand-new client has no id to attach
  // references to until then.
  const syncReferences = async (clientId: string) => {
    const original = clientDetail?.references ?? [];
    const originalById = new Map(original.map((ref) => [ref.id, ref]));
    const currentIds = new Set(
      referenceRows.filter((row) => row.id).map((row) => row.id),
    );

    const removed = original.filter((ref) => !currentIds.has(ref.id));
    const additions = referenceRows.filter((row) => !row.id);
    const changed = referenceRows.filter((row) => {
      if (!row.id) {
        return false;
      }
      const before = originalById.get(row.id);
      return (
        before &&
        (before.type !== row.type ||
          before.fullName !== row.fullName ||
          before.phoneNumber !== row.phoneNumber ||
          before.relationship !== row.relationship)
      );
    });

    for (const ref of removed) {
      await removeReference.mutateAsync({ clientId, referenceId: ref.id });
    }
    for (const row of additions) {
      await addReference.mutateAsync({
        clientId,
        input: {
          type: row.type,
          fullName: row.fullName.trim(),
          phoneNumber: row.phoneNumber.trim(),
          relationship: row.relationship.trim(),
        },
      });
    }
    for (const row of changed) {
      await updateReference.mutateAsync({
        clientId,
        referenceId: row.id!,
        input: {
          type: row.type,
          fullName: row.fullName.trim(),
          phoneNumber: row.phoneNumber.trim(),
          relationship: row.relationship.trim(),
        },
      });
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      // Without this pair, clicking "Guardar cliente" with an invalid
      // field scrolled out of view did nothing visible at all — the
      // admin had no way to tell a validation error from a dead button
      // or a lost connection.
      setFormError(
        'Hay campos obligatorios sin completar o con errores — revisa lo marcado en rojo.',
      );
      scrollToFirstError(errors);
      return;
    }
    setFieldErrors({});

    setIsUploading(true);
    let uploadedUrls;
    try {
      uploadedUrls = await uploadPendingFiles();
    } catch (err) {
      setFormError(
        err instanceof ImageUploadError
          ? err.message
          : 'No se pudo subir uno de los archivos. Intenta de nuevo.',
      );
      setIsUploading(false);
      return;
    }
    setIsUploading(false);

    setIsSubmitting(true);
    try {
      const savedClient = await onSubmit({
        firstName,
        lastName,
        documentNumber,
        phoneNumber,
        ...(creditLimit > 0 ? { creditLimit } : {}),
        ...(documentType ? { documentType: documentType as DocumentType } : {}),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(gender ? { gender: gender as Gender } : {}),
        ...(documentIssuePlace.trim()
          ? { documentIssuePlace: documentIssuePlace.trim() }
          : {}),
        ...(documentIssueDate ? { documentIssueDate } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(alternatePhoneNumber.trim()
          ? { alternatePhoneNumber: alternatePhoneNumber.trim() }
          : {}),
        ...(homeAddress.trim() ? { homeAddress: homeAddress.trim() } : {}),
        ...(workAddress.trim() ? { workAddress: workAddress.trim() } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(occupation.trim() ? { occupation: occupation.trim() } : {}),
        ...(employerName.trim() ? { employerName: employerName.trim() } : {}),
        ...(monthlyIncome > 0 ? { monthlyIncome } : {}),
        ...uploadedUrls,
        dataProcessingConsent,
      });

      try {
        await syncReferences(savedClient.id);
      } catch {
        // The client itself already saved successfully at this point — a
        // reference sync failure shouldn't look like the whole save
        // failed, but it does need to block the "close and forget"
        // behavior below so the admin knows to retry from the (now
        // editing) form instead of assuming everything saved.
        setFormError(
          'El cliente se guardó, pero una de las referencias no se pudo guardar. Vuelve a intentarlo.',
        );
        setIsSubmitting(false);
        return;
      }

      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        // Backend throws ConflictException("A client with document number
        // X already exists") for a duplicate cédula — surface that next to
        // the Cédula field instead of as a raw banner message, per Phase 3.
        if (err.statusCode === 409 && /document number/i.test(err.message)) {
          const errors: FieldErrors = {
            documentNumber: 'Ya existe un cliente registrado con esta cédula.',
          };
          setFieldErrors(errors);
          scrollToFirstError(errors);
        } else if (
          err.statusCode === 409 &&
          /phone number/i.test(err.message)
        ) {
          // Backend throws ConflictException("A client with phone number X
          // already exists") for a duplicate celular — same pattern as the
          // cédula conflict above. The check covers BOTH phoneNumber and
          // alternatePhoneNumber (a number can't be reused across either
          // field on another client — see ClientsService.
          // assertPhoneNumberIsUnique), and the message only names the
          // conflicting VALUE, not which of our two fields submitted it —
          // match it back to the right one so the error lands on the field
          // the admin actually needs to fix.
          const errors: FieldErrors =
            alternatePhoneNumber && err.message.includes(alternatePhoneNumber)
              ? {
                  alternatePhoneNumber:
                    'Ya existe un cliente registrado con este celular.',
                }
              : {
                  phoneNumber:
                    'Ya existe un cliente registrado con este celular.',
                };
          setFieldErrors(errors);
          scrollToFirstError(errors);
        } else if (err.statusCode === 400 && /consent/i.test(err.message)) {
          const errors: FieldErrors = {
            dataProcessingConsent:
              'El cliente debe autorizar el tratamiento de datos personales antes de guardar.',
          };
          setFieldErrors(errors);
          scrollToFirstError(errors);
        } else if (err.statusCode === 400 && /dirección/i.test(err.message)) {
          // Phase 26 — defense in depth: the form's own validate() already
          // blocks this case before a request is ever sent, but this
          // mirrors that error next to the address fields just in case
          // (e.g. a stale form state) the backend rejects it anyway.
          const errors: FieldErrors = {
            address:
              'Debes registrar al menos una dirección (de residencia o de trabajo).',
          };
          setFieldErrors(errors);
          scrollToFirstError(errors);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('No se pudo guardar el cliente. Intenta de nuevo.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBusy = isUploading || isSubmitting;

  return (
    <Modal maxWidth="max-w-[560px]" scroll>
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-medium text-white">
          {isEditing ? 'Editar cliente' : 'Nuevo cliente'}
        </h2>
        <CloseButton onClick={onClose} />
      </div>

      {/* Phase 20 — the "Solo administradores pueden crear clientes." line
          shown here for a new client was removed: ClientsController.create
          migrated from @Roles(Admin) to @RequireModule(AppModule.Clients),
          so a collector granted the clients module can create one too —
          the old text was simply no longer true. This form is only ever
          reachable via ClientsListPage's "Nuevo cliente" button, which is
          already gated the same way, so no replacement subtitle is needed
          for the create case. See docs/phases/PHASE_20_MODULE_PERMISSIONS.md. */}
      {isEditing && (
        <p className="mt-1 text-label text-muted">
          Editando: {client?.firstName} {client?.lastName} · ID #
          {client?.id.slice(0, 8)}
        </p>
      )}

      <div className="mt-5 border-t border-border" />

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-6">
        <FormSection title="Datos personales">
          <div className="flex gap-4">
            <Field
              label="Nombre"
              error={fieldErrors.firstName}
              id={fieldElementId('firstName')}
            >
              <input
                required
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                  setFieldErrors((prev) => ({
                    ...prev,
                    firstName: undefined,
                  }));
                }}
                placeholder="Ej: Carlos"
                className={inputClassName(Boolean(fieldErrors.firstName))}
              />
            </Field>
            <Field
              label="Apellido"
              error={fieldErrors.lastName}
              id={fieldElementId('lastName')}
            >
              <input
                required
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value);
                  setFieldErrors((prev) => ({
                    ...prev,
                    lastName: undefined,
                  }));
                }}
                placeholder="Ej: Mendoza"
                className={inputClassName(Boolean(fieldErrors.lastName))}
              />
            </Field>
          </div>

          <div className="flex gap-4">
            <Field
              label="Cédula"
              error={fieldErrors.documentNumber}
              id={fieldElementId('documentNumber')}
            >
              <input
                required
                value={documentNumber}
                onChange={(event) => {
                  setDocumentNumber(event.target.value);
                  setFieldErrors((prev) => ({
                    ...prev,
                    documentNumber: undefined,
                  }));
                }}
                placeholder="Ej: 1234567890"
                className={inputClassName(Boolean(fieldErrors.documentNumber))}
              />
            </Field>
            <Field
              label="Tipo de documento"
              error={fieldErrors.documentType}
              id={fieldElementId('documentType')}
            >
              <Select
                value={documentType}
                onChange={(value) => {
                  setDocumentType(value);
                  setFieldErrors((prev) => ({
                    ...prev,
                    documentType: undefined,
                  }));
                }}
                options={DOCUMENT_TYPE_OPTIONS}
                placeholder="Selecciona un tipo"
                className="w-full"
              />
            </Field>
            <Field label="Sexo / Género (opcional)">
              <Select
                value={gender}
                onChange={setGender}
                options={GENDER_OPTIONS}
                placeholder="Sin especificar"
                className="w-full"
              />
            </Field>
          </div>

          <div className="flex gap-4">
            <Field
              label={
                dateOfBirth
                  ? `Fecha de nacimiento (opcional) — ${calculateAge(dateOfBirth)} años`
                  : 'Fecha de nacimiento (opcional)'
              }
            >
              <DatePicker
                value={dateOfBirth}
                onChange={setDateOfBirth}
                className={inputClassName(false)}
              />
            </Field>
            <Field label="Fecha de expedición (opcional)">
              <DatePicker
                value={documentIssueDate}
                onChange={setDocumentIssueDate}
                className={inputClassName(false)}
              />
            </Field>
            <Field label="Lugar de expedición (opcional)">
              <input
                value={documentIssuePlace}
                onChange={(event) => setDocumentIssuePlace(event.target.value)}
                placeholder="Ej: Cali"
                className={inputClassName(false)}
              />
            </Field>
          </div>

          <div className="flex gap-4">
            <Field label="Ocupación (opcional)">
              <input
                value={occupation}
                onChange={(event) => setOccupation(event.target.value)}
                placeholder="Ej: Comerciante"
                className={inputClassName(false)}
              />
            </Field>
            <Field label="Empresa (opcional)">
              <input
                value={employerName}
                onChange={(event) => setEmployerName(event.target.value)}
                placeholder="Ej: Almacén La Economía"
                className={inputClassName(false)}
              />
            </Field>
          </div>

          <div className="flex gap-4">
            <Field label="Ingreso mensual (opcional)">
              <CurrencyInput
                value={monthlyIncome}
                onChange={setMonthlyIncome}
                placeholder="Sin especificar"
                className={inputClassName(false)}
              />
            </Field>
            <Field label="Cupo (opcional)">
              <CurrencyInput
                value={creditLimit}
                onChange={setCreditLimit}
                placeholder="Sin cupo (ilimitado)"
                className={inputClassName(false)}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Contacto">
          <div className="flex gap-4">
            <Field
              label="Celular"
              error={fieldErrors.phoneNumber}
              id={fieldElementId('phoneNumber')}
            >
              <input
                required
                value={phoneNumber}
                onChange={(event) => {
                  setPhoneNumber(event.target.value);
                  setFieldErrors((prev) => ({
                    ...prev,
                    phoneNumber: undefined,
                  }));
                }}
                onBlur={(event) => {
                  // Check the format as soon as the user leaves the field,
                  // instead of only at submit — a purely client-side regex
                  // test, so it adds no server load (2026-09-06 request).
                  const trimmed = event.target.value.trim();
                  if (!trimmed) {
                    return;
                  }
                  if (!CO_PHONE_REGEX.test(trimmed)) {
                    setFieldErrors((prev) => ({
                      ...prev,
                      phoneNumber:
                        'Debe ser un número colombiano válido, ej: +573001234567.',
                    }));
                  }
                }}
                placeholder="Ej: +573158001234"
                className={inputClassName(Boolean(fieldErrors.phoneNumber))}
              />
            </Field>
            <Field
              label="Celular alterno (opcional)"
              error={fieldErrors.alternatePhoneNumber}
              id={fieldElementId('alternatePhoneNumber')}
            >
              <input
                value={alternatePhoneNumber}
                onChange={(event) => {
                  setAlternatePhoneNumber(event.target.value);
                  setFieldErrors((prev) => ({
                    ...prev,
                    alternatePhoneNumber: undefined,
                  }));
                }}
                onBlur={(event) => {
                  // Same immediate-feedback check as phoneNumber above —
                  // optional field, so an empty value is not an error.
                  const trimmed = event.target.value.trim();
                  if (!trimmed) {
                    return;
                  }
                  if (!CO_PHONE_REGEX.test(trimmed)) {
                    setFieldErrors((prev) => ({
                      ...prev,
                      alternatePhoneNumber:
                        'Debe ser un número colombiano válido, ej: +573001234567.',
                    }));
                  }
                }}
                placeholder="Ej: +573001234567"
                className={inputClassName(
                  Boolean(fieldErrors.alternatePhoneNumber),
                )}
              />
            </Field>
          </div>
          <Field
            label="Correo electrónico (opcional)"
            error={fieldErrors.email}
            id={fieldElementId('email')}
          >
            <input
              // type="text" instead of "email" — see EMAIL_REGEX's own
              // comment: the native email-format check this used to rely
              // on rejects ñ/accented letters outright. inputMode keeps
              // the "@"-friendly mobile keyboard the "email" type used to
              // give for free.
              type="text"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }}
              onBlur={(event) => {
                const trimmed = event.target.value.trim();
                if (!trimmed) {
                  return;
                }
                if (!EMAIL_REGEX.test(trimmed)) {
                  setFieldErrors((prev) => ({
                    ...prev,
                    email: 'Debe ser un correo electrónico válido.',
                  }));
                }
              }}
              placeholder="Ej: cliente@correo.com"
              className={inputClassName(Boolean(fieldErrors.email))}
            />
          </Field>
        </FormSection>

        <FormSection title="Direcciones">
          <div id={fieldElementId('address')} className="flex flex-col gap-3.5">
            <p className="text-meta text-muted">
              Debes registrar al menos una de las dos direcciones.
            </p>
            <Field label="Dirección de residencia">
              <input
                value={homeAddress}
                onChange={(event) => {
                  setHomeAddress(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, address: undefined }));
                }}
                placeholder="Ej: Cra 10 #20-30"
                className={inputClassName(Boolean(fieldErrors.address))}
              />
            </Field>
            <Field label="Dirección de trabajo">
              <input
                value={workAddress}
                onChange={(event) => {
                  setWorkAddress(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, address: undefined }));
                }}
                placeholder="Ej: Cl 5 #8-12, Local 3"
                className={inputClassName(Boolean(fieldErrors.address))}
              />
            </Field>
            {fieldErrors.address && (
              <span className="text-meta text-danger" role="alert">
                {fieldErrors.address}
              </span>
            )}
          </div>
          <Field label="Ciudad (opcional)">
            <input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Ej: Cali"
              className={inputClassName(false)}
            />
          </Field>
        </FormSection>

        <FormSection title="Referencias">
          <div
            id={fieldElementId('references')}
            className="flex flex-col gap-3"
          >
            {referenceRows.length === 0 && (
              <p className="text-meta text-muted">
                Sin referencias agregadas todavía.
              </p>
            )}
            {referenceRows.map((row) => {
              // Only flags it red once a submit attempt has actually
              // failed (fieldErrors.references set) — otherwise every
              // reference row would turn red the instant it's typed
              // into, before the admin has even finished the number.
              const phoneFormatInvalid =
                Boolean(fieldErrors.references) &&
                Boolean(row.phoneNumber.trim()) &&
                !CO_PHONE_REGEX.test(row.phoneNumber.trim());
              return (
                <div
                  key={row.rowId}
                  className="flex flex-col gap-2 rounded border border-border bg-input p-3"
                >
                  <div className="flex items-center justify-between">
                    <Select
                      value={row.type}
                      onChange={(value) =>
                        updateReferenceRow(row.rowId, {
                          type: value as ClientReferenceType,
                        })
                      }
                      options={Object.values(ClientReferenceType).map(
                        (type) => ({
                          value: type,
                          label: CLIENT_REFERENCE_TYPE_LABELS[type],
                        }),
                      )}
                      className="w-40"
                    />
                    <button
                      type="button"
                      onClick={() => removeReferenceRow(row.rowId)}
                      className="text-meta text-muted hover:text-danger"
                    >
                      Quitar
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={row.fullName}
                      onChange={(event) =>
                        updateReferenceRow(row.rowId, {
                          fullName: event.target.value,
                        })
                      }
                      placeholder="Nombre completo"
                      className="h-9 flex-1 rounded border border-border bg-background px-2.5 text-small text-white placeholder-mid focus:border-subtle focus:outline-none"
                    />
                    <input
                      value={row.phoneNumber}
                      onChange={(event) =>
                        updateReferenceRow(row.rowId, {
                          phoneNumber: event.target.value,
                        })
                      }
                      placeholder="Teléfono — ej: +573001234567"
                      className={`h-9 w-36 rounded border bg-background px-2.5 text-small text-white placeholder-mid focus:outline-none ${
                        phoneFormatInvalid
                          ? 'border-danger focus:border-danger'
                          : 'border-border focus:border-subtle'
                      }`}
                    />
                  </div>
                  <input
                    value={row.relationship}
                    onChange={(event) =>
                      updateReferenceRow(row.rowId, {
                        relationship: event.target.value,
                      })
                    }
                    placeholder="Relación — ej: hermano, vecino, proveedor"
                    className="h-9 rounded border border-border bg-background px-2.5 text-small text-white placeholder-mid focus:border-subtle focus:outline-none"
                  />
                </div>
              );
            })}
            {fieldErrors.references && (
              <span className="text-meta text-danger" role="alert">
                {fieldErrors.references}
              </span>
            )}
            <ChipButton onClick={addReferenceRow}>
              <PlusIcon />
              Agregar referencia
            </ChipButton>
          </div>
        </FormSection>

        <FormSection title="Documentos">
          <Field label="Documento de identidad — frente (opcional, foto o PDF combinado)">
            <FileUploadField
              file={idDocumentFrontFile}
              onFileChange={setIdDocumentFrontFile}
              existingUrl={client?.idDocumentFrontUrl}
              disabled={isBusy}
            />
          </Field>
          <Field label="Documento de identidad — reverso (opcional)">
            <FileUploadField
              file={idDocumentBackFile}
              onFileChange={setIdDocumentBackFile}
              existingUrl={client?.idDocumentBackUrl}
              disabled={isBusy}
            />
          </Field>
          <Field label="Selfie (opcional — el cliente tiene derecho a negarse a proporcionarla)">
            <FileUploadField
              file={selfieFile}
              onFileChange={setSelfieFile}
              existingUrl={client?.selfieImageUrl}
              accept="image/*"
              disabled={isBusy}
            />
          </Field>
        </FormSection>

        <FormSection title="Autorización de tratamiento de datos">
          <label
            id={fieldElementId('dataProcessingConsent')}
            className="flex items-start gap-2.5"
          >
            <input
              type="checkbox"
              checked={dataProcessingConsent}
              onChange={(event) => {
                setDataProcessingConsent(event.target.checked);
                setFieldErrors((prev) => ({
                  ...prev,
                  dataProcessingConsent: undefined,
                }));
              }}
              className="mt-0.5 size-4 shrink-0 rounded border-border bg-input accent-white"
            />
            <span className="text-control text-white">
              El cliente firmó la autorización de tratamiento de datos.
            </span>
          </label>
          {fieldErrors.dataProcessingConsent && (
            <span className="text-meta text-danger" role="alert">
              {fieldErrors.dataProcessingConsent}
            </span>
          )}
          {client?.consentGivenAt && (
            <p className="text-meta text-muted">
              Registrado el{' '}
              {new Date(client.consentGivenAt).toLocaleString('es-CO')}.
            </p>
          )}
          <Field label="Evidencia de la autorización firmada (opcional)">
            <FileUploadField
              file={consentDocumentFile}
              onFileChange={setConsentDocumentFile}
              existingUrl={client?.consentDocumentUrl}
              disabled={isBusy}
            />
          </Field>
        </FormSection>

        {formError && (
          <p className="text-small text-danger" role="alert">
            {formError}
          </p>
        )}

        <div className="border-t border-border" />

        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isBusy}>
            {isUploading
              ? 'Subiendo archivos…'
              : isSubmitting
                ? 'Guardando…'
                : isEditing
                  ? 'Guardar cambios'
                  : 'Guardar cliente'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// inputClassName, Field, and FormSection now live in @/lib/formStyles and
// @/components/ui/Field — this file used to redeclare all three locally,
// identically to LoanForm.tsx/RefinanceLoanForm.tsx/
// InterestConceptTypeForm.tsx, which was the exact kind of copy-paste
// drift that let a few buttons miss the 2026-09-02 accent-color rollout.
// See DESIGN_TOKENS.md's "Component-based centralization" section.
