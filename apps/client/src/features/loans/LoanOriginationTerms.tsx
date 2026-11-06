import { ConceptCalculationType } from '@/features/interestConceptTypes/interestConceptTypesApi';
import { InstallmentFrequency } from '@/features/loans/loansApi';
import { useLoanOriginationTerms } from '@/features/loans/useLoans';
import { formatCurrency, formatDateOnly } from '@/lib/format';

import type { LoanOriginationTerms as Terms } from '@/features/loans/loansApi';

// Human request, 2026-11-05 — "necesitamos poder saber a qué tasa se les
// financió a los clientes, es decir, cómo fue creado el crédito … al
// refinanciar o liquidar esta información es requerida casi en todos los
// casos". The terms are read back exactly as stored at creation
// (GET /loans/:id/origination-terms); a rate that was never stored shows as
// "No registrada" — nothing is inferred (confirmed with the human).
//
// Shown on the loan detail page (with every loan it was refinanced from) and
// inside the refinance and payoff dialogs (this loan only, `compact`).

function formatRate(rate: number): string {
  return `${rate.toLocaleString('es-CO', { maximumFractionDigits: 4 })}%`;
}

function frequencyLabel(frequency: InstallmentFrequency): {
  period: string;
  plural: string;
} {
  return frequency === InstallmentFrequency.Biweekly
    ? { period: 'quincenal', plural: 'quincenales' }
    : { period: 'mensual', plural: 'mensuales' };
}

function TermsGrid({ terms }: { terms: Terms }) {
  const frequency = frequencyLabel(terms.installmentFrequency);
  const items: { label: string; value: string; hint?: string }[] = [
    {
      label: 'Tasa corriente',
      value:
        terms.corrienteInterestRate === null
          ? 'No registrada'
          : `${formatRate(terms.corrienteInterestRate)} ${frequency.period}`,
      hint: 'Interés corriente cobrado en cada cuota sobre el saldo de capital.',
    },
    {
      label: 'Tasa moratoria',
      value:
        terms.moratoryInterestRate === null
          ? 'No registrada'
          : `${formatRate(terms.moratoryInterestRate)} mensual`,
      hint: 'Mora sobre el valor de la cuota vencida, prorrateada por día.',
    },
    {
      label: 'Capital financiado',
      value: formatCurrency(terms.principalAmount),
    },
    {
      label: 'Plazo',
      value: `${terms.financedInstallments} cuotas ${frequency.plural}`,
    },
    {
      label: 'Valor de la cuota',
      value:
        terms.installmentAmount === null
          ? '—'
          : formatCurrency(terms.installmentAmount),
    },
    {
      label: 'Desembolso',
      value: formatDateOnly(terms.disbursedAt),
    },
  ];
  if (terms.downPaymentAmount !== null) {
    items.push({
      label: 'Cuota inicial',
      value: formatCurrency(terms.downPaymentAmount),
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} title={item.hint}>
            <dt className="text-[10px] font-normal text-muted">{item.label}</dt>
            <dd className="mt-1 text-control text-white">{item.value}</dd>
          </div>
        ))}
      </dl>
      {terms.otherCharges.length > 0 && (
        <p className="text-meta text-muted">
          Otros cargos:{' '}
          {terms.otherCharges
            .map(
              (charge) =>
                `${charge.name} (${
                  charge.calculationType === ConceptCalculationType.Percentage
                    ? formatRate(charge.value)
                    : formatCurrency(charge.value)
                })`,
            )
            .join(', ')}
        </p>
      )}
      {terms.refinanceMoraWaivedAmount > 0 && (
        <p className="text-meta text-muted">
          Al crearse por refinanciación se condonaron{' '}
          <span className="text-white">
            {formatCurrency(terms.refinanceMoraWaivedAmount)}
          </span>{' '}
          de mora
          {terms.refinanceMoraWaiverReason
            ? ` — ${terms.refinanceMoraWaiverReason}`
            : ''}
          .
        </p>
      )}
    </div>
  );
}

export function LoanOriginationTerms({
  loanId,
  compact = false,
}: {
  loanId: string;
  // Only this loan's own terms, no refinance history — for the refinance
  // and payoff dialogs, where it's reference next to the figures.
  compact?: boolean;
}) {
  const { data, isLoading, isError } = useLoanOriginationTerms(loanId);

  if (isLoading) {
    return (
      <p className="text-meta text-muted">Cargando condiciones del crédito…</p>
    );
  }
  if (isError || !data || data.length === 0) {
    return (
      <p className="text-meta text-muted">
        No se pudieron cargar las condiciones del crédito.
      </p>
    );
  }

  return <LoanOriginationTermsView terms={data} compact={compact} />;
}

// The section itself, from terms already in hand — also used by the deleted
// pagaré's read-only view (Phase 35), whose terms come inside
// GET /loans/deleted/:id. `terms` is this loan first, then every loan it was
// refinanced from.
export function LoanOriginationTermsView({
  terms,
  compact = false,
}: {
  terms: Terms[];
  compact?: boolean;
}) {
  const [current, ...previous] = terms;
  if (!current) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
      <span className="text-label text-muted">
        Condiciones con las que se creó el crédito
      </span>
      <TermsGrid terms={current} />

      {!compact && previous.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <span className="text-label text-muted">
            Pagarés anteriores (refinanciados)
          </span>
          {previous.map((earlier) => (
            <div key={earlier.loanId} className="flex flex-col gap-2">
              <span className="text-small text-white">
                Pagaré {earlier.promissoryNoteNumber} · creado el{' '}
                {formatDateOnly(earlier.disbursedAt)}
              </span>
              <TermsGrid terms={earlier} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
