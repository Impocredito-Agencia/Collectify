import { useHealth } from '@/features/health/useHealth';

// Temporary Phase 1 page — proves the client can reach the API through
// apiClient end to end. Replaced once Phase 7 lands the real dashboard.
export function HealthCheckPage() {
  const { data, isLoading, isError, error } = useHealth();

  return (
    <div className="max-w-md rounded border border-border bg-surface p-6">
      <h1 className="text-card-title font-medium text-white">
        Conexión con la API
      </h1>
      <p className="mt-1 text-small text-muted">
        Página temporal de la Fase 1 — se elimina en la Fase 7.
      </p>

      <div className="mt-4 text-small">
        {isLoading && <span className="text-muted">Consultando…</span>}
        {isError && (
          <span className="text-danger">
            Error: {error instanceof Error ? error.message : 'desconocido'}
          </span>
        )}
        {data && (
          <span className="font-medium text-success">
            API responde: {data.status}
          </span>
        )}
      </div>
    </div>
  );
}
