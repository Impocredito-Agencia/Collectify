import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { FilterTab } from '@/components/ui/FilterTab';
import { InterestConceptTypeForm } from '@/features/interestConceptTypes/InterestConceptTypeForm';
import {
  ConceptCalculationType,
  ConceptCategory,
} from '@/features/interestConceptTypes/interestConceptTypesApi';
import {
  useCreateInterestConceptType,
  useDeactivateInterestConceptType,
  useInterestConceptTypes,
  useUpdateInterestConceptType,
} from '@/features/interestConceptTypes/useInterestConceptTypes';

import type { InterestConceptType } from '@/features/interestConceptTypes/interestConceptTypesApi';

function formatDefaultValue(conceptType: InterestConceptType): string {
  if (conceptType.defaultValue == null) {
    return 'Sin valor por defecto';
  }
  return conceptType.defaultCalculationType ===
    ConceptCalculationType.Percentage
    ? `${conceptType.defaultValue}%`
    : `$${conceptType.defaultValue.toLocaleString('es-CO')}`;
}

// Admin screen for the catalog of additional-charge types introduced in
// Phase 14 — the admin can add new charge types whenever needed, not pick
// from a fixed list. Loans pick from this catalog at creation time
// (LoanForm.tsx). Deactivating a type only removes it from that picker —
// loans that already used it keep the name/value they were generated with
// (snapshot), unaffected.
export function InterestConceptTypesPage() {
  const [showInactive, setShowInactive] = useState(false);
  const {
    data: conceptTypes,
    isLoading,
    isError,
  } = useInterestConceptTypes({
    isActive: !showInactive,
  });

  const [formTarget, setFormTarget] = useState<
    InterestConceptType | 'new' | null
  >(null);

  const createConceptType = useCreateInterestConceptType();
  const updateConceptType = useUpdateInterestConceptType();
  const deactivateConceptType = useDeactivateInterestConceptType();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Header
          title="Tipos de cargo"
          subtitle="Catálogo de cargos corrientes y moratorios usado al crear préstamos"
        />
        <Button
          onClick={() => setFormTarget('new')}
          className="flex items-center gap-1.5"
        >
          {/* Matches the "+ Nuevo cliente"/"+ Nuevo préstamo" buttons —
              this one was missing the icon entirely. */}
          <svg
            className="size-3.5 shrink-0"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M10 4v12M4 10h12"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
          Nuevo cargo
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <FilterTab
          label="Activos"
          isActive={!showInactive}
          onClick={() => setShowInactive(false)}
        />
        <FilterTab
          label="Desactivados"
          isActive={showInactive}
          onClick={() => setShowInactive(true)}
        />
      </div>

      {isLoading && <p className="text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="text-small text-danger" role="alert">
          No se pudieron cargar los cargos adicionales.
        </p>
      )}
      {!isLoading && !isError && conceptTypes?.length === 0 && (
        <p className="text-small text-muted">
          {showInactive
            ? 'No hay cargos adicionales desactivados.'
            : 'Todavía no hay cargos adicionales — crea el primero.'}
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        {conceptTypes?.map((conceptType) => (
          <div
            key={conceptType.id}
            className="flex items-center justify-between rounded-lg bg-surface px-5 py-3.5"
          >
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-card-title font-medium text-white">
                  {conceptType.name}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    conceptType.category === ConceptCategory.Moratorio
                      ? 'bg-danger/15 text-danger'
                      : 'bg-white/10 text-muted'
                  }`}
                >
                  {conceptType.category === ConceptCategory.Moratorio
                    ? 'Moratorio'
                    : 'Corriente'}
                </span>
                {conceptType.isUsuryRateConcept && (
                  <span
                    className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white"
                    title="Aparece siempre, sin poder quitarse, en todo préstamo de esta categoría."
                  >
                    Obligatorio (usura)
                  </span>
                )}
              </div>
              <span className="text-meta text-muted">
                {conceptType.defaultCalculationType ===
                ConceptCalculationType.Percentage
                  ? 'Porcentaje'
                  : 'Monto fijo'}{' '}
                · {formatDefaultValue(conceptType)}
              </span>
            </div>
            {!showInactive && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setFormTarget(conceptType)}
                  className="text-meta text-muted hover:text-white"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => deactivateConceptType.mutate(conceptType.id)}
                  className="text-meta text-muted hover:text-danger"
                >
                  Desactivar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {formTarget && (
        <InterestConceptTypeForm
          conceptType={formTarget === 'new' ? undefined : formTarget}
          onSubmit={(input) =>
            formTarget === 'new'
              ? createConceptType.mutateAsync(input)
              : updateConceptType.mutateAsync({ id: formTarget.id, input })
          }
          onClose={() => setFormTarget(null)}
        />
      )}
    </div>
  );
}
