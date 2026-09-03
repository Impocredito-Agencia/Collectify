import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { CollectifyMark } from '@/components/ui/CollectifyMark';
import { useAuth } from '@/features/auth/useAuth';
import { ApiError } from '@/lib/apiClient';

import type { FormEvent } from 'react';
import type { Location } from 'react-router-dom';

// Matches the Figma "Design System" file, frame 16:2 ("Login / Desktop —
// 1440") exactly — colors/spacing/type sizes all come from the theme
// tokens in index.css, extracted from that same file's library page.
// Tablet/tablet mobile variants of this frame haven't been reviewed yet.
export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const redirectTo =
    (location.state as { from?: Location } | null)?.from?.pathname ?? '/';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login({ email, password });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo iniciar sesión. Intenta de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[440px] rounded border border-border bg-surface px-11 py-12">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          {/* Style cleanup (2026-09-02): swapped the old "C" letter-in-a-box
              for the shared CollectifyMark used in Sidebar.tsx — same
              bg-input tile instead of a flat white square. Kept this tile
              at size-7, unlike the Sidebar's bigger size-9 — this lockup
              already sits next to its own two-line "Collectify / Gestión de
              cobros" wordmark, and the Figma-matched heading right below it
              (frame 16:2) sets the visual scale for this card, not this
              logo row. */}
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-input">
            <CollectifyMark className="size-5" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-body text-white">Collectify</span>
            <span className="text-section-label tracking-normal text-subtle">
              Gestión de cobros
            </span>
          </div>
        </div>

        {/* Heading */}
        <div className="mt-7">
          <h1 className="text-h1 font-light tracking-tight text-white">
            Inicia sesión
          </h1>
          <p className="mt-1.5 text-body text-muted">
            Accede a tu panel de cobranza
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 flex flex-col">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-label font-normal tracking-normal text-muted"
            >
              CORREO ELECTRÓNICO
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="tu@empresa.com"
              className="h-11 w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
            />
          </div>

          <div className="mt-3 flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-label font-normal tracking-normal text-muted"
            >
              CONTRASEÑA
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="h-11 w-full rounded border border-border bg-input px-3.5 text-control text-white placeholder-mid focus:border-subtle focus:outline-none"
            />
          </div>

          {error && (
            <p className="mt-2.5 text-small text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="mt-2.5 flex justify-end">
            <button
              type="button"
              className="text-small text-subtle hover:text-muted"
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 h-12 w-full rounded-lg bg-accent text-control font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Ingresando…' : 'Entrar'}
          </button>
        </form>

        <div className="mt-6 border-t border-border" />

        <p className="mt-4 text-center text-label text-subtle">
          Al ingresar, aceptas los términos de uso de la plataforma.
        </p>
      </div>
    </div>
  );
}
