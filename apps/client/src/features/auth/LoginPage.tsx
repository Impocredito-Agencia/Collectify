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
      // AuthService.login (apps/api/src/auth/auth.service.ts) returns the
      // same generic 401 "Invalid credentials" whether the email doesn't
      // exist, the password is wrong, or the account was deactivated —
      // deliberate (confirmed with the human, 2026-09-03): distinguishing
      // "cuenta desactivada" here would let an unauthenticated caller
      // probe which accounts exist/are active. This was previously shown
      // verbatim (untouched English), which the client flagged — same
      // fix as ChangePasswordCard's 401 handling: intercept the status
      // code and show one Spanish message for all three cases, rather
      // than surfacing err.message.
      if (err instanceof ApiError && err.statusCode === 401) {
        setError('Correo o contraseña incorrectos.');
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : 'No se pudo iniciar sesión. Intenta de nuevo.',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[440px] rounded border border-border bg-surface px-11 py-12">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          {/* Style cleanup (2026-09-03): dropped the bg-input tile behind
              the mark — Sidebar.tsx's twenty-first pass already removed
              that same tile (its own box, bigger than the mark for
              padding, read as asymmetric weight next to the wordmark);
              this page still had the old tiled version. Also bumped from
              size-5/text-body (client compared it against Sidebar's much
              bigger size-8/text-[22px] header and asked why this page's
              own logo was so much smaller).
              Second pass: back to icon-left-of-wordmark (Sidebar's own
              arrangement), just bigger.
              Third pass: "Gestión de cobros" goes directly under
              "Collectify" specifically, not centered under the icon+name
              row as a whole — so the tagline stacks in its own column
              next to the mark, rather than sitting below both.
              Fourth pass: "Collectify" doubled again, text-[22px] →
              text-[44px], then dialed back to text-[40px] — leading-none
              added so the taller line-height doesn't push the tagline
              further down and widen the gap-0.5 stack.
              Fifth pass: dropped the centering (justify-center) that the
              first pass added. With the logo this big, a centered block
              sitting directly above the left-aligned "Inicia sesión"
              heading/form read as two different alignment systems
              stacked on each other — the client felt something was off
              but centering (not size) was the actual cause. Left-aligned
              now, same column as everything below it, matching the
              original Figma frame 16:2 lockup's alignment (just much
              bigger). */}
          <CollectifyMark className="size-12 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[40px] font-semibold leading-none text-white">
              Collectify
            </span>
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
              // type="text" instead of "email" — human report, 2026-09-10:
              // see @/lib/emailPattern.ts's comment. The native
              // email-format check this used to rely on rejects
              // ñ/accented letters outright, which would lock out anyone
              // logging in with such an address. No extra format
              // validation added here (unlike ClientForm.tsx/UserForm.tsx)
              // — a malformed value just fails the same generic "Correo o
              // contraseña incorrectos" the backend already returns for
              // any wrong login, so there's nothing more useful to check
              // client-side. inputMode keeps the "@"-friendly mobile
              // keyboard the "email" type gave for free.
              type="text"
              inputMode="email"
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
              ¿Olvidó su contraseña?
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
