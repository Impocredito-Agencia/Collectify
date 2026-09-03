import { useState } from 'react';

import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Td, Th } from '@/components/ui/Table';
import {
  useCurrentUsuryRate,
  useSetUsuryRate,
  useUsuryRateHistory,
} from '@/features/usuryRates/useUsuryRates';
import { ApiError } from '@/lib/apiClient';

import type { FormEvent } from 'react';

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
  const [ratePercentage, setRatePercentage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const parsedRate = parseFloat(ratePercentage);
    if (!effectiveMonth || !Number.isFinite(parsedRate)) {
      setFormError('Ingresa el mes y la tasa certificada.');
      return;
    }

    setIsSubmitting(true);
    try {
      await setRate.mutateAsync({
        effectiveMonth: `${effectiveMonth}-01`,
        ratePercentage: parsedRate,
      });
      setRatePercentage('');
    } catch (err) {
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

      {isLoadingCurrent && <p className="text-small text-muted">Cargando…</p>}
      {isCurrentError && (
        <p className="text-small text-danger" role="alert">
          No se pudo cargar la tasa vigente.
        </p>
      )}

      {!isLoadingCurrent && !isCurrentError && (
        <div className="rounded-lg bg-surface px-5 py-4">
          {current ? (
            <div className="flex flex-col gap-1">
              <span className="text-meta text-muted">
                Tasa vigente ({formatMonth(current.effectiveMonth)})
              </span>
              <span className="text-card-title font-medium text-white">
                {current.ratePercentage}%
              </span>
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
        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[10px] font-normal tracking-normal text-muted">
              Mes certificado
            </span>
            <input
              type="month"
              value={effectiveMonth}
              onChange={(event) => setEffectiveMonth(event.target.value)}
              className="h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white focus:border-subtle focus:outline-none"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[10px] font-normal tracking-normal text-muted">
              Tasa certificada (%)
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={ratePercentage}
              onChange={(event) => setRatePercentage(event.target.value)}
              placeholder="Ej: 29.5"
              className="h-[42px] w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
            />
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
          <div className="overflow-hidden rounded-lg bg-surface">
            <table className="w-full">
              {/* Style cleanup (2026-09-02): this table had no size/color
                  tokens at all — plain `px-5 py-3`, default text color,
                  no `bg-input` header — found while auditing every table
                  in the app for typography drift. Now matches every other
                  list table (`Th`/`Td`, `bg-input` header). */}
              <thead className="bg-input">
                <tr>
                  <Th>Mes</Th>
                  <Th className="text-right">Tasa</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((rate) => (
                  <tr key={rate.id} className="border-t border-border">
                    <Td>{formatMonth(rate.effectiveMonth)}</Td>
                    <Td className="text-right">{rate.ratePercentage}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatMonth(dateString: string): string {
  // dateString is 'YYYY-MM-DD' (first of month) — parse as UTC to avoid a
  // timezone shift landing on the wrong month, same caution documented in
  // installmentCalculations.ts on the api side.
  const [year, month] = dateString.split('-');
  return new Date(
    Date.UTC(Number(year), Number(month) - 1, 1),
  ).toLocaleDateString('es-CO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
