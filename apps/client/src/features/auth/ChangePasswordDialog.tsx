import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { authApi } from '@/features/auth/authApi';
import { ApiError } from '@/lib/apiClient';
import { inputClassName } from '@/lib/formStyles';

import type { FormEvent } from 'react';

type FieldName = 'currentPassword' | 'newPassword' | 'confirmPassword';
type FieldErrors = Partial<Record<FieldName, string>>;

// Despite the filename (kept as-is — this project's workspace folder
// doesn't allow renaming/deleting files, see apps/client/docs/
// DESIGN_TOKENS.md), this is no longer a modal. It started as one,
// triggered from a key icon in the Sidebar footer, before the client
// shared the real Figma design: a "Cambiar contraseña" card embedded in a
// dedicated "Mi perfil" page (ProfilePage.tsx), next to "Información de
// cuenta". This is that embedded card now — no backdrop, no
// useEscapeKey/CloseButton, just the form.
//
// authApi.changePassword (POST /auth/change-password) has existed since
// Phase 2 — it was part of that phase's own scope checklist — but nothing
// ever called it until this component. See "Known design/backend gaps".
//
// Password rules: the design shows "Mínimo 8 caracteres", "Al menos una
// mayúscula", "Al menos un número" as a hint list, but ChangePasswordDto
// only validates @MinLength(8) — no complexity rules. Raised via
// AskUserQuestion; the client chose to only show the one real rule rather
// than add backend validation for the other two.
//
// "Cancelar" (fixed 2026-09-03): used to call resetFields — technically
// correct, but on a page with no dialog to dismiss, that meant nothing
// visible happened at all if you hadn't typed anything, which the client
// read as the button "doing nothing". Raised via AskUserQuestion; the
// client chose real navigation over a form-clear: it now returns to
// whichever screen you were on before opening Mi perfil (navigate(-1),
// browser history), not a fixed route — same fix applied to
// UserDetailPage.tsx's "Usuarios" breadcrumb for the same reason.
export function ChangePasswordCard() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetFields = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setFieldErrors({});
    setFormError(null);
  };

  // Mirrors ChangePasswordDto's own validators (apps/api/src/auth/dto/
  // changePassword.dto.ts: @IsNotEmpty currentPassword, @MinLength(8)
  // newPassword) so the obvious mistakes are caught before hitting the API.
  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!currentPassword) {
      errors.currentPassword = 'Ingresa tu contraseña actual.';
    }
    if (newPassword.length < 8) {
      errors.newPassword =
        'La nueva contraseña debe tener al menos 8 caracteres.';
    }
    if (confirmPassword !== newPassword) {
      errors.confirmPassword = 'Las contraseñas no coinciden.';
    }
    return errors;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await authApi.changePassword({ currentPassword, newPassword });
      resetFields();
      setSuccessMessage('Tu contraseña se actualizó correctamente.');
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        setFieldErrors({
          currentPassword: 'La contraseña actual es incorrecta.',
        });
      } else {
        setFormError(
          err instanceof ApiError
            ? err.message
            : 'No se pudo cambiar la contraseña. Intenta de nuevo.',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded border border-border bg-surface p-5">
      <span className="text-[10px] font-normal tracking-normal text-muted">
        CAMBIAR CONTRASEÑA
      </span>

      <form onSubmit={handleSubmit} className="mt-3.5 flex flex-col gap-3.5">
        <Field label="Contraseña actual" error={fieldErrors.currentPassword}>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
              setFieldErrors((prev) => ({
                ...prev,
                currentPassword: undefined,
              }));
            }}
            className={inputClassName(Boolean(fieldErrors.currentPassword))}
          />
        </Field>

        <Field label="Nueva contraseña" error={fieldErrors.newPassword}>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              setFieldErrors((prev) => ({ ...prev, newPassword: undefined }));
            }}
            placeholder="Mínimo 8 caracteres"
            className={inputClassName(Boolean(fieldErrors.newPassword))}
          />
        </Field>

        <Field label="Confirmar contraseña" error={fieldErrors.confirmPassword}>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              setFieldErrors((prev) => ({
                ...prev,
                confirmPassword: undefined,
              }));
            }}
            placeholder="Repite la nueva contraseña"
            className={inputClassName(Boolean(fieldErrors.confirmPassword))}
          />
        </Field>

        <div className="rounded bg-input px-3.5 py-2.5 text-meta text-muted">
          Mínimo 8 caracteres
        </div>

        {formError && (
          <p className="text-small text-danger" role="alert">
            {formError}
          </p>
        )}
        {successMessage && (
          <p className="text-small text-success">{successMessage}</p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando…' : 'Guardar cambios'}
          </Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}

// inputClassName now lives in @/lib/formStyles — see DESIGN_TOKENS.md's
// "Component-based centralization" section. Field stays local here: its
// layout (no flex-1, always full-width/stacked) differs from the shared
// component's default row layout.

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-normal tracking-normal text-muted">
        {label}
      </span>
      {children}
      {error && (
        <span className="text-meta text-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
