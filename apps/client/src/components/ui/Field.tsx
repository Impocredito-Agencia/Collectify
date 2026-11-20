import type { ReactNode } from 'react';

// Centralizes the label+input+error wrapper that nearly every form in the
// app previously redeclared as its own identical local `Field` function
// (ClientForm, LoanForm, UserForm, EditLoanDialog, InterestConceptTypeForm,
// RegisterPaymentDialog, BulkRegisterPaymentDialog, RefinanceLoanForm,
// ChangePasswordDialog — same JSX, copy-pasted). Same rationale as
// Button.tsx/Modal.tsx: one definition instead of nine copies that can
// silently drift apart.
interface FieldProps {
  label: string;
  error?: string;
  children: ReactNode;
  // Lets validation scroll straight to this field (see ClientForm.tsx's
  // scrollToFirstError) — only set on fields that are actually validated.
  id?: string;
  // 'row' (default) — `flex-1`, for fields sitting side-by-side in a
  // horizontal group (most forms). 'stack' — no `flex-1`, for a field
  // that's always full-width on its own line (UserForm,
  // ChangePasswordDialog).
  layout?: 'row' | 'stack';
  // 'compact' (default) — 10px label, 11px error, as everywhere so far.
  // 'readable' — 12px for both; Phase 36's Correo y SMS page runs on a
  // 12/13px scale only (human request, 2026-11-09).
  textSize?: 'compact' | 'readable';
}

export function Field({
  label,
  error,
  children,
  id,
  layout = 'row',
  textSize = 'compact',
}: FieldProps) {
  const isReadable = textSize === 'readable';
  return (
    <div
      id={id}
      className={
        layout === 'row'
          ? 'flex flex-1 flex-col gap-1.5'
          : 'flex flex-col gap-1.5'
      }
    >
      <span
        className={`${isReadable ? 'text-label' : 'text-[10px]'} font-normal tracking-normal text-muted`}
      >
        {label}
      </span>
      {children}
      {error && (
        <span
          className={`${isReadable ? 'text-label' : 'text-meta'} text-danger`}
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}

// Groups a form into titled sections ("DATOS PERSONALES", "CONTACTO",
// etc.) — was also copy-pasted identically into ClientForm.tsx and
// LoanForm.tsx.
interface FormSectionProps {
  title: string;
  children: ReactNode;
}

export function FormSection({ title, children }: FormSectionProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <span className="border-b border-border pb-1.5 text-label font-semibold tracking-normal text-white">
        {title.toUpperCase()}
      </span>
      {children}
    </div>
  );
}
