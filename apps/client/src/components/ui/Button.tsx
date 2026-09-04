import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Centralizes every button "look" in the app. Before this component
// existed, each screen hand-typed its own Tailwind className for
// "primary button", and small copy-paste drift (a different height, font
// weight, or padding on one instance) meant a palette change — like the
// 2026-09-02 accent-color rollout — had to be grepped and reapplied file
// by file, and silently missed a few (see DESIGN_TOKENS.md's "Brand
// accent & visual polish" section for the actual incident that prompted
// this). Now every button in the app renders through here, so a variant's
// look is defined exactly once.
export type ButtonVariant =
  'primary' | 'secondary' | 'neutral' | 'danger' | 'dangerSolid';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Main call-to-action — "Entrar", "Guardar cliente", "Crear préstamo",
  // etc. Brand-accent orange, per the 2026-09-02 visual polish.
  primary:
    'rounded-lg bg-accent px-4 py-2.5 text-small font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60',
  // "Cancelar" — the low-emphasis dismiss action next to every primary
  // button in a modal/form.
  //
  // hover:bg-border added 2026-09-04 — same fix RowActionButton.tsx and
  // Select.tsx already had (see RowActionButton's own comment): text alone
  // lighting up on hover reads as broken, since the box around it stays
  // dark and inert. bg-border is the same translucent white wash used
  // app-wide for this exact "the box lights up too" hover.
  secondary:
    'rounded border border-border bg-input px-4 py-2.5 text-small text-muted hover:bg-border hover:text-white disabled:cursor-not-allowed disabled:opacity-60',
  // Mid-emphasis confirm for a reversible action that isn't the form's
  // main CTA but also isn't destructive — "Sí, desactivar" (a client/user
  // can be reactivated later), "Subir archivo" in the Excel import
  // dialog.
  //
  // hover:bg-white/10 added 2026-09-04, same reason as secondary above —
  // this variant had no hover state at all. Already rests on bg-border
  // (the wash secondary hovers *to*), so it needs a step further; bg-white/10
  // is the next shade up from that same translucent-white family.
  neutral:
    'rounded border border-subtle bg-border px-4 py-2.5 text-small text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60',
  // Destructive action, soft/outline treatment — "Sí, eliminar" in
  // DeleteLoanDialog.
  danger:
    'rounded border border-danger/40 bg-danger/10 px-4 py-2.5 text-small text-danger hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-60',
  // Destructive action, solid treatment — reserved for the final,
  // no-undo confirm step (e.g. PayoffDialog's "Sí, liquidar
  // definitivamente" after the soft warning).
  dangerSolid:
    'rounded bg-danger px-4 py-2.5 text-small font-semibold text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60',
};

interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className'
> {
  variant?: ButtonVariant;
  children: ReactNode;
  // Escape hatch only — for one-off sizing (e.g. a button that must match
  // an adjacent 42px-tall input) or a `w-fit`/`self-start` layout need.
  // Never use this to re-color or re-shape a button; add a variant
  // instead so the look stays centralized.
  className?: string;
}

export function Button({
  variant = 'primary',
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${VARIANT_CLASSES[variant]}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
