import {
  ConceptCalculationType,
  ConceptCategory,
} from '@/features/interestConceptTypes/interestConceptTypesApi';
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
// Shown on the loan detail page, inside the refinance and payoff dialogs, and
// on a deleted pagaré's read-only view — always this loan's own terms only.
// The endpoint also returns every loan it was refinanced from, but the human
// found the whole chain stacked here hard to read (2026-11-06): an earlier
// link's terms are on that loan's own page.

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

interface ChargeRow {
  name: string;
  value: string;
  // A secondary line under the value (e.g. "por cuota vencida").
  detail?: string;
  hint?: string;
}

// One grid for the summary and both charge groups, so their columns line up.
const TILE_GRID = 'grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3';

const GROUP_TONES = {
  corriente: { dot: 'bg-accent-secondary', edge: 'border-l-accent-secondary' },
  // Red like the "M" badge on the cuotas table's moratorio columns.
  moratorio: { dot: 'bg-danger', edge: 'border-l-danger' },
} as const;

// Every charge with the same weight as the rates (human request, 2026-11-06 —
// "otros cargos" had been a small grey line easy to miss), grouped by how it
// is charged: corriente on every cuota, moratorio only on an overdue one.
// Each charge is its own small card, its left edge in the group's color, so
// the charges read apart at a glance instead of as one flat block.
function ChargeGroup({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: keyof typeof GROUP_TONES;
  rows: ChargeRow[];
}) {
  const colors = GROUP_TONES[tone];
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2 text-small text-muted">
        <span className={`size-2 rounded-full ${colors.dot}`} />
        {title}
      </span>
      <dl className={TILE_GRID}>
        {rows.map((row, index) => (
          <div
            key={`${row.name}-${index}`}
            title={row.hint}
            className={`rounded border border-l-2 border-border ${colors.edge} bg-input px-3 py-2`}
          >
            <dt className="text-small text-muted">{row.name}</dt>
            <dd className="mt-1 text-small font-medium text-white">
              {row.value}
              {row.detail && (
                <span className="font-normal text-muted"> {row.detail}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TermsGrid({ terms }: { terms: Terms }) {
  const frequency = frequencyLabel(terms.installmentFrequency);
  const items: { label: string; value: string }[] = [
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

  const corrienteCharges = terms.otherCharges.filter(
    (charge) => charge.category === ConceptCategory.Corriente,
  );
  const moratoryCharges = terms.otherCharges.filter(
    (charge) => charge.category === ConceptCategory.Moratorio,
  );

  const corrienteRows: ChargeRow[] = [
    {
      name: 'Intereses corrientes',
      value:
        terms.corrienteInterestRate === null
          ? 'No registrada'
          : `${formatRate(terms.corrienteInterestRate)} ${frequency.period}`,
      hint: 'Interés corriente cobrado en cada cuota sobre el saldo de capital.',
    },
    ...corrienteCharges.map((charge) => ({
      name: charge.name,
      value:
        charge.calculationType === ConceptCalculationType.Percentage
          ? `${formatRate(charge.value)} ${frequency.period}`
          : formatCurrency(charge.value),
      hint:
        charge.calculationType === ConceptCalculationType.Percentage
          ? 'Se cobra en cada cuota sobre el saldo de capital.'
          : 'Valor fijo configurado para este cargo.',
    })),
  ];

  const moratoryRows: ChargeRow[] = [
    {
      name: 'Intereses moratorios',
      value:
        terms.moratoryInterestRate === null
          ? 'No registrada'
          : `${formatRate(terms.moratoryInterestRate)} mensual`,
      hint: 'Mora sobre el valor de la cuota vencida, prorrateada por día.',
    },
    ...moratoryCharges.map((charge) =>
      charge.calculationType === ConceptCalculationType.Percentage
        ? {
            name: charge.name,
            value: `${formatRate(charge.value)} mensual`,
            hint: 'Sobre el valor de la cuota vencida, prorrateado por día.',
          }
        : {
            name: charge.name,
            value: formatCurrency(charge.value),
            detail: 'por cuota vencida',
            hint: 'Valor fijo cobrado una vez por cada cuota vencida.',
          },
    ),
  ];

  // The summary is split in the same two halves as the charge groups below,
  // each item padded like a charge card's text, so every column starts at
  // the same place on both sides.
  const halves = [items.slice(0, 2), items.slice(2)];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        {halves.map((half, index) => (
          <dl key={index} className={TILE_GRID}>
            {half.map((item) => (
              <div
                key={item.label}
                className="border border-l-2 border-transparent px-3"
              >
                <dt className="text-small text-muted">{item.label}</dt>
                <dd className="mt-1 text-small text-white">{item.value}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ChargeGroup
          title="Se cobra en cada cuota"
          tone="corriente"
          rows={corrienteRows}
        />
        <ChargeGroup
          title="En caso de mora"
          tone="moratorio"
          rows={moratoryRows}
        />
      </div>
      {terms.refinanceMoraWaivedAmount > 0 && (
        <p className="text-small text-muted">
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

export function LoanOriginationTerms({ loanId }: { loanId: string }) {
  const { data, isLoading, isError } = useLoanOriginationTerms(loanId);

  if (isLoading) {
    return (
      <p className="text-small text-muted">Cargando condiciones del crédito…</p>
    );
  }
  if (isError || !data || data.length === 0) {
    return (
      <p className="text-small text-muted">
        No se pudieron cargar las condiciones del crédito.
      </p>
    );
  }

  return <LoanOriginationTermsView terms={data} />;
}

// The section itself, from terms already in hand — also used by the deleted
// pagaré's read-only view (Phase 35), whose terms come inside
// GET /loans/deleted/:id. `terms` is this loan first, then every loan it was
// refinanced from; only the first is shown (see this file's top comment).
export function LoanOriginationTermsView({ terms }: { terms: Terms[] }) {
  const [current] = terms;
  if (!current) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
      <span className="text-small text-muted">
        Condiciones con las que se creó el crédito
      </span>
      <TermsGrid terms={current} />
    </section>
  );
}
