import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import {
  ConceptCalculationType,
  ConceptCategory,
  FixedAmountDistribution,
} from '@/features/interestConceptTypes/interestConceptTypesApi';
import { ApiError } from '@/lib/apiClient';
import { inputClassName } from '@/lib/formStyles';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type {
  CreateInterestConceptTypeInput,
  InterestConceptType,
} from '@/features/interestConceptTypes/interestConceptTypesApi';
import type { FormEvent } from 'react';

interface InterestConceptTypeFormProps {
  // Present = editing; absent = creating — same convention as ClientForm.tsx.
  conceptType?: InterestConceptType;
  // Pre-selects the category when creating from a context that already
  // knows which side it needs (e.g. LoanForm.tsx's "Cargos moratorios"
  // section) — ignored when editing (conceptType.category wins).
  defaultCategory?: ConceptCategory;
  onSubmit: (input: CreateInterestConceptTypeInput) => Promise<unknown>;
  onClose: () => void;
}

type FieldName = 'name' | 'fixedAmountDistribution';
type FieldErrors = Partial<Record<FieldName, string>>;

const CALCULATION_TYPE_OPTIONS = [
  { value: ConceptCalculationType.Percentage, label: 'Porcentaje (%)' },
  { value: ConceptCalculationType.FixedAmount, label: 'Monto fijo ($)' },
];

const CATEGORY_OPTIONS = [
  { value: ConceptCategory.Corriente, label: 'Corriente' },
  { value: ConceptCategory.Moratorio, label: 'Moratorio (solo en mora)' },
];

const DISTRIBUTION_OPTIONS = [
  {
    value: FixedAmountDistribution.SplitAcrossInstallments,
    label: 'Repartir entre todas las cuotas',
  },
  {
    value: FixedAmountDistribution.FirstInstallmentOnly,
    label: 'Cobrar solo en la primera cuota',
  },
];

// The admin can create new charge types at any time, not pick from a fixed
// list — this form is what makes that possible. defaultValue is a plain
// number field, not CurrencyInput (which hardcodes a "$" prefix and
// whole-peso formatting) — a percentage charge's value (e.g. 2.5) isn't a
// peso amount.
export function InterestConceptTypeForm({
  conceptType,
  defaultCategory,
  onSubmit,
  onClose,
}: InterestConceptTypeFormProps) {
  const isEditing = Boolean(conceptType);

  const [name, setName] = useState(conceptType?.name ?? '');
  const [calculationType, setCalculationType] = useState(
    conceptType?.defaultCalculationType ?? ConceptCalculationType.Percentage,
  );
  const [category, setCategory] = useState(
    conceptType?.category ?? defaultCategory ?? ConceptCategory.Corriente,
  );
  const [fixedAmountDistribution, setFixedAmountDistribution] = useState(
    conceptType?.fixedAmountDistribution ?? undefined,
  );
  const [defaultValue, setDefaultValue] = useState(
    conceptType?.defaultValue != null ? String(conceptType.defaultValue) : '',
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEscapeKey(onClose);

  // Only a corriente fixed_amount concept needs a distribution mode — a
  // moratorio one is always charged once, flat, on the overdue installment
  // (confirmed with the human), and a percentage concept has no "amount" to
  // distribute at all. See docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
  const requiresDistribution =
    calculationType === ConceptCalculationType.FixedAmount &&
    category === ConceptCategory.Corriente;

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!name.trim()) {
      errors.name = 'El nombre es obligatorio.';
    }
    if (requiresDistribution && !fixedAmountDistribution) {
      errors.fixedAmountDistribution = 'Elegí cómo se reparte este cargo.';
    }
    return errors;
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

    const parsedDefaultValue = parseFloat(defaultValue);

    try {
      await onSubmit({
        name: name.trim(),
        defaultCalculationType: calculationType,
        category,
        fixedAmountDistribution: requiresDistribution
          ? fixedAmountDistribution
          : undefined,
        defaultValue: Number.isFinite(parsedDefaultValue)
          ? parsedDefaultValue
          : undefined,
      });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError('No se pudo guardar el cargo. Intenta de nuevo.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[420px]">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-medium text-white">
          {isEditing ? 'Editar cargo' : 'Nuevo cargo adicional'}
        </h2>
        <CloseButton onClick={onClose} />
      </div>
      <p className="mt-1 text-label text-muted">
        Los préstamos que ya usan este cargo conservan su propio valor, aunque
        lo edites o lo desactives aquí.
      </p>

      <div className="mt-5 border-t border-border" />

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3.5">
        <Field label="Nombre" error={fieldErrors.name}>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setFieldErrors((prev) => ({ ...prev, name: undefined }));
            }}
            className={inputClassName(Boolean(fieldErrors.name))}
          />
        </Field>

        <Field label="Tipo de cálculo">
          <Select
            value={calculationType}
            onChange={(value) =>
              setCalculationType(value as ConceptCalculationType)
            }
            options={CALCULATION_TYPE_OPTIONS}
          />
        </Field>

        <Field label="Categoría">
          <Select
            value={category}
            onChange={(value) => setCategory(value as ConceptCategory)}
            options={CATEGORY_OPTIONS}
          />
        </Field>

        {requiresDistribution && (
          <Field
            label="Cómo se reparte"
            error={fieldErrors.fixedAmountDistribution}
          >
            <Select
              value={fixedAmountDistribution ?? ''}
              onChange={(value) => {
                setFixedAmountDistribution(value as FixedAmountDistribution);
                setFieldErrors((prev) => ({
                  ...prev,
                  fixedAmountDistribution: undefined,
                }));
              }}
              options={DISTRIBUTION_OPTIONS}
              placeholder="Elegí una opción"
            />
          </Field>
        )}

        <Field label="Valor por defecto (opcional)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={defaultValue}
            onChange={(event) => setDefaultValue(event.target.value)}
            className={inputClassName(false)}
          />
        </Field>

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
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? 'Guardando…'
              : isEditing
                ? 'Guardar cambios'
                : 'Crear cargo'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// inputClassName and Field now live in @/lib/formStyles and
// @/components/ui/Field — see DESIGN_TOKENS.md's "Component-based
// centralization" section.
