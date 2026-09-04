import { Link } from 'react-router-dom';

import { useAuth } from '@/features/auth/useAuth';
import { useCurrentUsuryRate } from '@/features/usuryRates/useUsuryRates';

// Persistent, hard-to-miss banner shown wherever someone would otherwise
// start creating a loan — confirmed with the client (see
// docs/phases/PHASE_15_USURY_RATE.md "Stale-rate alert") this is NOT a
// dismiss-once-and-forget banner: it keeps showing every session until a
// current-month rate is entered, since the SFC's publication date moves
// around and there's no fixed day to remind on instead. GET
// /usury-rates/current is open to any authenticated user as of Phase 24
// (a collector who can create a loan needs this warning too, since a
// missing/stale rate is now a hard block, not just a validation gap) — so
// this can be rendered for any user, not just admins.
export function StaleUsuryRateBanner() {
  const { user } = useAuth();
  const { data: current, isPending } = useCurrentUsuryRate();

  // GET /usury-rates/current returns null when NO rate has ever been
  // entered (not just when the latest one is from a prior month) — that
  // case must show this banner too. Bug fixed 2026-08-18: the original
  // `!current?.isStale` check treated a null `current` (nothing entered
  // yet at all) as "not stale" and silently suppressed the banner in
  // exactly the situation it exists to warn about.
  if (isPending) return null;
  if (current?.isStale === false) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-small text-amber-200"
    >
      <span>
        No has agregado la tasa de usura de este mes — no se pueden crear ni
        refinanciar préstamos hasta que se agregue.
      </span>
      {/* Phase 20 — POST /usury-rates and the /tasa-de-usura route both
          migrated to @RequireModule(AppModule.UsuryRates) (was admin-only)
          — a collector who wasn't granted this module still can't act on
          this link, so only offer it to an admin or someone granted the
          usury_rates module; anyone else needs to ask one of those instead.
          See docs/phases/PHASE_20_MODULE_PERMISSIONS.md. */}
      {user &&
        (user.role === 'admin' || user.modules.includes('usury_rates')) && (
          <Link
            to="/tasa-de-usura"
            className="shrink-0 font-semibold text-amber-100 underline hover:text-white"
          >
            Registrar tasa
          </Link>
        )}
    </div>
  );
}
