import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { Td, Th } from '@/components/ui/Table';
import { convertAnnualToMonthlyRate } from '@/features/usuryRates/convertAnnualToMonthlyRate';
import {
  useCurrentUsuryRate,
  useSetUsuryRate,
  useUsuryRateHistory,
} from '@/features/usuryRates/useUsuryRates';
import { ApiError } from '@/lib/apiClient';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { FormEvent } from 'react';

// The Superintendencia's own press-release page for "interés bancario
// corriente" (crédito de consumo y ordinario) — where the admin looks up
// each month's certified annual rate before entering it below. Added
// 2026-09-03, client request. A plain hardcoded link (not admin-editable):
// it's the one official source, not user data.
const SUPERFINANCIERA_RATE_URL =
  'https://www.superfinanciera.gov.co/publicaciones/10829/sala-de-prensacomunicados-de-prensa-interes-bancario-corriente-10829/';

// The Superintendencia's own annual→monthly rate converter/simulator —
// a second official link, added same day: not something the app needs to
// compute for the admin (convertAnnualToMonthlyRate.ts already does that
// live below), but useful as an independent cross-check against the
// number this page just calculated, from the same authority that
// publishes the rate itself.
const SUPERFINANCIERA_CONVERTER_URL =
  'https://www.superfinanciera.gov.co/publicaciones/61554/consumidor-financieroinformacion-generalsimulador-de-conversion-de-tasas-de-interes-61554/';

// Admin-only settings screen for Colombia's usury ceiling (Phase 15) — see
// docs/phases/PHASE_15_USURY_RATE.md. Unlike interest concept types, rates
// are append-only history (no edit/deactivate): entering a new month's
// value never touches a previous month's row, confirmed non-retroactive
// with the human. The form only ever adds a new row.
export function UsuryRatesPage() {
  const {
    data: current,
    isLoading: isLoadingCurrent,
    isError: isCurrentError,
  } = useCurrentUsuryRate();
  const { data: history, isLoading: isLoadingHistory } = useUsuryRateHistory();
  const setRate = useSetUsuryRate();

  const [effectiveMonth, setEffectiveMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  // Bug fix, 2026-09-03 — was ratePercentage (the monthly figure, computed
  // by hand before typing it in). Now this holds the raw annual rate as
  // published; monthlyPreview below shows what the app will actually store
  // and apply, computed live as the admin types.
  const [annualRatePercentage, setAnnualRatePercentage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Client request, 2026-09-03 — a two-step confirm before this ever
  // reaches the API, on top of the disclaimer text above: 'review' shows
  // back the exact anual/mensual values about to be saved, 'final' is a
  // second, separate modal (not the same one morphing in place, unlike
  // PayoffDialog's isConfirmingFinal pattern) with its confirm/cancel
  // buttons swapped left-right versus every other dialog in the app —
  // deliberately, so confirming this last step takes a conscious look
  // instead of a reflexive click on "the button that's always on the
  // right". Nothing is sent to the API until 'final' is confirmed.
  const [confirmStep, setConfirmStep] = useState<'closed' | 'review' | 'final'>(
    'closed',
  );

  const parsedAnnualRate = parseFloat(annualRatePercentage);
  const monthlyPreview = Number.isFinite(parsedAnnualRate)
    ? convertAnnualToMonthlyRate(parsedAnnualRate)
    : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!effectiveMonth || !Number.isFinite(parsedAnnualRate)) {
      setFormError('Ingresa el mes y la tasa anual certificada.');
      return;
    }

    setConfirmStep('review');
  };

  const handleConfirmedSave = async () => {
    setIsSubmitting(true);
    try {
      await setRate.mutateAsync({
        effectiveMonth: `${effectiveMonth}-01`,
        annualRatePercentage: parsedAnnualRate,
      });
      setAnnualRatePercentage('');
      setConfirmStep('closed');
    } catch (err) {
      setConfirmStep('closed');
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo guardar la tasa. Intenta de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Header
        title="Tasa de usura"
        subtitle="Solo ADMIN — techo legal mensual certificado por la Superintendencia Financiera"
      />

      {/* Client feedback, 2026-09-03 — the original single link here was a
          dim, small, underlined line of text ("difícil de ver nada más
          entrar a la página"). Rebuilt as two visible cards using
          `accent-secondary` (the blue token index.css already reserves
          for "text links, secondary emphasis" but that, until now, no
          component actually used) so they read as real navigation, not
          a footnote — plus the client's second Superintendencia link, the
          rate converter/simulator, as an independent cross-check against
          what this page calculates on its own. */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-5 py-4">
        <span className="text-[10px] font-normal tracking-normal text-muted">
          Recursos oficiales de la Superintendencia Financiera
        </span>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <SuperintendenciaLink
            href={SUPERFINANCIERA_RATE_URL}
            label="Tasa certificada del mes"
            description="Interés bancario corriente — consumo y ordinario"
          />
          <SuperintendenciaLink
            href={SUPERFINANCIERA_CONVERTER_URL}
            label="Simulador de conversión de tasas"
            description="Para verificar el cálculo de anual a mensual"
          />
        </div>
      </div>

      {isLoadingCurrent && <p className="text-small text-muted">Cargando…</p>}
      {isCurrentError && (
        <p className="text-small text-danger" role="alert">
          No se pudo cargar la tasa vigente.
        </p>
      )}

      {!isLoadingCurrent && !isCurrentError && (
        <div className="rounded-lg bg-surface px-5 py-4">
          {current ? (
            <div className="flex flex-col gap-3">
              <span className="text-meta text-muted">
                Tasa vigente ({formatMonth(current.effectiveMonth)})
              </span>
              <div className="flex items-end gap-6">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted">
                    Anual (Superintendencia)
                  </span>
                  <span className="text-card-title font-medium text-white">
                    {current.annualRatePercentage ?? '—'}%
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted">
                    Mensual (aplicada en los préstamos)
                  </span>
                  <span className="text-card-title font-medium text-white">
                    {current.ratePercentage}%
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-small text-muted">
              Todavía no se ha registrado ninguna tasa.
            </p>
          )}
          {current?.isStale && (
            <p className="mt-2.5 text-small text-amber-400" role="alert">
              La tasa de{' '}
              {new Date().toLocaleDateString('es-CO', {
                month: 'long',
                year: 'numeric',
              })}{' '}
              todavía no se ha ingresado. Regístrala abajo apenas la
              Superintendencia la publique — la fecha de publicación varía cada
              mes.
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3.5 rounded-lg bg-surface px-5 py-4"
      >
        <span className="text-[10px] font-normal tracking-normal text-muted">
          Registrar nueva tasa mensual
        </span>
        {/* Client question, 2026-09-03 — "¿el valor va a ponerse para
            ambas cosas?". Yes, by construction: LoansService forces every
            percentage-type concept (Corriente y Moratorio) to this exact
            monthly value, never an admin-typed one — see
            resolveConcepts/resolveMoratoryConcepts, Phase 24. This is
            purely explanatory copy; the underlying behavior already
            existed before this note was added. */}
        <p className="-mt-1 text-small text-muted">
          Esta tasa mensual se aplica automáticamente tanto a los cargos
          corrientes como a los moratorios — es el mismo techo legal para ambos
          (Art. 884 del Código de Comercio), no se calcula por separado.
        </p>
        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[10px] font-normal tracking-normal text-muted">
              Mes certificado
            </span>
            <MonthPicker
              value={effectiveMonth}
              onChange={setEffectiveMonth}
              ariaLabel="Mes certificado"
              className="h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[10px] font-normal tracking-normal text-muted">
              Tasa anual certificada (%)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={annualRatePercentage}
              onChange={(event) => {
                // type="text" + inputMode, not type="number" — same reason
                // CurrencyInput.tsx avoids type="number": its native
                // increment/decrement arrows can't be hidden reliably
                // cross-browser, and here nobody uses them, they just type
                // the published rate and move on (client screenshot,
                // 2026-09-03). Accepts a comma as the decimal separator too
                // (normalized to a dot) since that's how the rate appears
                // on the Superintendencia's own page.
                const raw = event.target.value.replace(',', '.');
                if (/^\d*\.?\d*$/.test(raw)) {
                  setAnnualRatePercentage(raw);
                }
              }}
              placeholder="Ej: 29.24"
              className="h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[10px] font-normal tracking-normal text-muted">
              Mensual equivalente (calculada)
            </span>
            <div className="flex h-[42px] w-full items-center rounded border border-border bg-input/50 px-3.5 text-control text-muted">
              {monthlyPreview !== null ? `${monthlyPreview}%` : '—'}
            </div>
          </div>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-[42px] shrink-0"
          >
            {isSubmitting ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
        {formError && (
          <p className="text-small text-danger" role="alert">
            {formError}
          </p>
        )}
        {/* Client request, 2026-09-03 — a static disclaimer rather than
            validation logic: this value drives every loan's interest
            calculation app-wide (see the note above), and there's no
            reliable way to auto-verify it against the Superintendencia's
            page, so the safeguard is just making sure whoever enters it
            double-checks by hand. */}
        <p className="text-small text-amber-400">
          Verifica bien la tasa antes de guardar — cobrar por encima de la tasa
          de usura es delito en Colombia (Art. 305 del Código Penal).
        </p>
      </form>

      <div className="flex flex-col gap-2.5">
        <span className="text-[10px] font-normal tracking-normal text-muted">
          Historial
        </span>
        {isLoadingHistory && <p className="text-small text-muted">Cargando…</p>}
        {!isLoadingHistory && history?.length === 0 && (
          <p className="text-small text-muted">
            Todavía no hay tasas registradas.
          </p>
        )}
        {!isLoadingHistory && history && history.length > 0 && (
          <div className="overflow-x-auto rounded-lg bg-surface">
            <table className="w-full min-w-[480px]">
              {/* Style cleanup (2026-09-02): this table had no size/color
                  tokens at all — plain `px-5 py-3`, default text color,
                  no `bg-input` header — found while auditing every table
                  in the app for typography drift. Now matches every other
                  list table (`Th`/`Td`, `bg-input` header). */}
              <thead className="bg-input">
                <tr>
                  <Th>Mes</Th>
                  <Th className="text-right">Tasa anual</Th>
                  <Th className="text-right">Tasa mensual aplicada</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((rate) => (
                  <tr key={rate.id} className="border-t border-border">
                    <Td>{formatMonth(rate.effectiveMonth)}</Td>
                    <Td className="text-right" muted>
                      {rate.annualRatePercentage !== null
                        ? `${rate.annualRatePercentage}%`
                        : '—'}
                    </Td>
                    <Td className="text-right">{rate.ratePercentage}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmStep === 'review' && Number.isFinite(parsedAnnualRate) && (
        <ReviewRateModal
          monthLabel={formatMonth(`${effectiveMonth}-01`)}
          annualRate={parsedAnnualRate}
          monthlyRate={monthlyPreview ?? 0}
          previousRate={
            current && current.effectiveMonth !== `${effectiveMonth}-01`
              ? {
                  annualRatePercentage: current.annualRatePercentage,
                  monthLabel: formatMonth(current.effectiveMonth),
                }
              : null
          }
          onCancel={() => setConfirmStep('closed')}
          onConfirm={() => setConfirmStep('final')}
        />
      )}

      {confirmStep === 'final' && Number.isFinite(parsedAnnualRate) && (
        <FinalConfirmRateModal
          monthLabel={formatMonth(`${effectiveMonth}-01`)}
          annualRate={parsedAnnualRate}
          monthlyRate={monthlyPreview ?? 0}
          isSubmitting={isSubmitting}
          onCancel={() => setConfirmStep('closed')}
          onConfirm={() => void handleConfirmedSave()}
        />
      )}
    </div>
  );
}

// A single "official resource" card — bigger tap target, visible border,
// and the icon/title in `accent-secondary` blue instead of the previous
// dim underlined text, so both links are obvious at a glance instead of
// something you have to hunt for (client feedback, 2026-09-03).
function SuperintendenciaLink({
  href,
  label,
  description,
}: {
  href: string;
  label: string;
  description: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-1 items-center gap-3 rounded border border-border bg-input px-4 py-3 hover:border-accent-secondary/50 hover:bg-input/70"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-secondary/10 text-accent-secondary">
        <svg
          className="size-4"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
        >
          <path
            d="M8 5H5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 5 16h8a1.5 1.5 0 0 0 1.5-1.5v-3"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M11.5 4h4.5v4.5M16 4l-6.5 6.5"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-small font-medium text-accent-secondary group-hover:underline">
          {label}
        </span>
        <span className="text-meta text-muted">{description}</span>
      </span>
    </a>
  );
}

interface RateConfirmModalProps {
  monthLabel: string;
  annualRate: number;
  monthlyRate: number;
}

// Step 1 of 2 — same button layout/position as every other confirm dialog
// in the app (Cancelar left, primary action right). Client feedback,
// 2026-09-03: the first pass at this was one plain sentence with two
// inline numbers — "muy simple", with room to spare. Reworked as two
// stat-card boxes (same visual language as the "Tasa vigente" card at the
// top of the page — label + big number) so the two values that matter are
// the first thing the eye lands on, plus an optional comparison against
// whatever rate is currently on file, purely as a visual sanity check
// (not a blocking validation — the client explicitly asked for a
// disclaimer, not enforced logic, when this came up earlier).
function ReviewRateModal({
  monthLabel,
  annualRate,
  monthlyRate,
  previousRate,
  onCancel,
  onConfirm,
}: RateConfirmModalProps & {
  previousRate: {
    annualRatePercentage: number | null;
    monthLabel: string;
  } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEscapeKey(onCancel);

  const delta =
    previousRate?.annualRatePercentage != null
      ? annualRate - previousRate.annualRatePercentage
      : null;

  return (
    <Modal maxWidth="max-w-[500px]">
      <h2 className="text-card-title font-medium text-white">
        Confirmar tasa de {monthLabel}
      </h2>
      <p className="mt-2.5 text-small text-muted">
        Estás a punto de registrar esta tasa como la vigente para {monthLabel}.
        Compárala con la de la Superintendencia antes de continuar — el valor
        mensual se calcula solo, a partir del anual.
      </p>

      <div className="mt-5 border-t border-border" />

      <div className="mt-5 flex items-stretch gap-3">
        <div className="flex flex-1 flex-col gap-1 rounded-lg bg-input px-4 py-3.5">
          <span className="text-[10px] text-muted">Tasa anual certificada</span>
          <span className="text-[24px] font-semibold leading-tight text-white">
            {annualRate}%
          </span>
          <span className="text-meta text-muted">
            Publicada por la Superintendencia
          </span>
        </div>

        <div className="flex flex-col items-center justify-center px-1 text-mid">
          <svg
            className="size-4"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M4 10h12M11 5l5 5-5 5"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="flex flex-1 flex-col gap-1 rounded-lg bg-input px-4 py-3.5">
          <span className="text-[10px] text-muted">Mensual equivalente</span>
          <span className="text-[24px] font-semibold leading-tight text-white">
            {monthlyRate}%
          </span>
          <span className="text-meta text-muted">
            Se aplica en corriente y moratorio
          </span>
        </div>
      </div>

      {previousRate && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-4 py-3">
          <span className="text-meta text-muted">
            Tasa actual en el sistema ({previousRate.monthLabel})
          </span>
          <span className="text-small text-white">
            {previousRate.annualRatePercentage != null
              ? `${previousRate.annualRatePercentage}% anual`
              : '—'}
            {delta !== null && (
              <span className="ml-1.5 text-muted">
                ({delta >= 0 ? '+' : ''}
                {Math.round(delta * 100) / 100} pts)
              </span>
            )}
          </span>
        </div>
      )}

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={onConfirm}>Continuar</Button>
      </div>
    </Modal>
  );
}

// Step 2 of 2 — a separate modal (not the same one changing in place), and
// its buttons are swapped left-right vs. ReviewRateModal above and vs.
// every other dialog in the app (Cancelar is always secondary/left
// elsewhere — see DeactivateUserDialog.tsx, PayoffDialog.tsx). Deliberate,
// per the client's request: this is the point of no return (rates are
// append-only, see the header comment above UsuryRatesPage), so the last
// click shouldn't land on habit/muscle memory.
//
// Client correction, 2026-09-03 — an earlier draft of this copy said "una
// corrección requeriría agregar una fila nueva más adelante", implying
// UsuryRateService already supported a second row for the same month.
// It doesn't: setRate() throws ConflictException on a duplicate
// effectiveMonth (see usuryRates.service.ts, "A duplicate month is
// rejected rather than silently overwritten"). That was never actually
// built — flagged to the human rather than left silently wrong. Until
// that's decided, this copy states the honest current behavior: once
// saved, this month's rate cannot be edited, deleted, or re-entered at
// all.
function FinalConfirmRateModal({
  monthLabel,
  annualRate,
  monthlyRate,
  isSubmitting,
  onCancel,
  onConfirm,
}: RateConfirmModalProps & {
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEscapeKey(onCancel);

  return (
    <Modal maxWidth="max-w-[500px]">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
          <svg
            className="size-5"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M10 3.5 17.5 16h-15L10 3.5Z"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M10 8v3.5" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="10" cy="13.8" r="0.9" fill="currentColor" />
          </svg>
        </div>
        <div>
          <h2 className="text-card-title font-medium text-white">
            Esta tasa no se podrá cambiar después
          </h2>
          <p className="mt-1.5 text-small text-muted">
            Confirma que {monthLabel} queda con estos valores — es definitivo,
            sin edición ni reversa posterior.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-stretch gap-3">
        <div className="flex flex-1 flex-col gap-1 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3.5">
          <span className="text-[10px] text-muted">Tasa anual certificada</span>
          <span className="text-[24px] font-semibold leading-tight text-white">
            {annualRate}%
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3.5">
          <span className="text-[10px] text-muted">Mensual equivalente</span>
          <span className="text-[24px] font-semibold leading-tight text-white">
            {monthlyRate}%
          </span>
        </div>
      </div>

      <p className="mt-4 text-small text-muted">
        Las dos quedan fijas juntas (la mensual se deriva de la anual, no se
        guardan por separado). Una vez guardada, esta fila de {monthLabel} no se
        puede editar ni borrar desde la app — verifica los números arriba antes
        de continuar.
      </p>

      <div className="mt-5 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button
          variant="dangerSolid"
          onClick={onConfirm}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Guardando…' : 'Sí, guardar definitivamente'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </Modal>
  );
}

function formatMonth(dateString: string): string {
  // dateString is 'YYYY-MM-DD' (first of month) — parse as UTC to avoid a
  // timezone shift landing on the wrong month, same caution documented in
  // installmentCalculations.ts on the api side.
  const [year, month] = dateString.split('-');
  const label = new Date(
    Date.UTC(Number(year), Number(month) - 1, 1),
  ).toLocaleDateString('es-CO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  // Client screenshot, 2026-09-03 — es-CO's toLocaleDateString lowercases
  // the month name ("septiembre de 2026"); capitalized here for every
  // caller (Tasa vigente card, Historial table, both confirm modals),
  // same fix already applied in MonthPicker.tsx's own formatMonthYear.
  return label.charAt(0).toUpperCase() + label.slice(1);
}
