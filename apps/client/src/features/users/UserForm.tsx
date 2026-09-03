import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ModuleChecklist } from '@/features/users/ModuleChecklist';
import { USER_ROLE_LABELS } from '@/features/users/usersApi';
import { ApiError } from '@/lib/apiClient';
import { inputClassName } from '@/lib/formStyles';
import { useEscapeKey } from '@/lib/useEscapeKey';

import type { AppModule, UserRole } from '@/features/auth/authApi';
import type { CreateUserInput, User } from '@/features/users/usersApi';
import type { FormEvent } from 'react';

interface UserFormProps {
  onSubmit: (input: CreateUserInput) => Promise<User>;
  // Called only when the new account is a collector with at least one
  // module checked — an admin always has full access, so there's nothing
  // to set for one. See docs/phasesClient/PHASE_20_MODULE_PERMISSIONS.md.
  onSetPermissions: (userId: string, modules: AppModule[]) => Promise<unknown>;
  onClose: () => void;
}

type FieldName = 'fullName' | 'email' | 'password';
type FieldErrors = Partial<Record<FieldName, string>>;

const ROLE_OPTIONS = (
  Object.entries(USER_ROLE_LABELS) as [UserRole, string][]
).map(([value, label]) => ({ value, label }));

// Create-only — no self-registration (confirmed Phase 8, see
// UsersService.create) and no edit endpoint on the backend at all, unlike
// ClientForm.tsx which doubles as both create and edit. Mirrors
// ClientForm.tsx's modal structure and field-error pattern regardless.
export function UserForm({
  onSubmit,
  onSetPermissions,
  onClose,
}: UserFormProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('collector');
  const [modules, setModules] = useState<AppModule[]>([]);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEscapeKey(onClose);

  // Mirrors CreateUserDto's validators client-side, same rationale as
  // ClientForm.tsx's validate().
  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};

    if (!fullName.trim()) {
      errors.fullName = 'El nombre es obligatorio.';
    }
    if (!email.trim()) {
      errors.email = 'El correo es obligatorio.';
    }
    if (password.length < 8) {
      errors.password = 'La contraseña debe tener al menos 8 caracteres.';
    }

    return errors;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setIsSubmitting(true);
    try {
      const savedUser = await onSubmit({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        role,
      });

      if (role === 'collector' && modules.length > 0) {
        try {
          await onSetPermissions(savedUser.id, modules);
        } catch {
          // The account itself already saved successfully — a permissions
          // failure shouldn't look like account creation failed, but does
          // need to surface so the admin knows to set them from the list
          // instead of assuming the checklist above took effect. Same
          // pattern as ClientForm.tsx's reference-sync failure.
          setFormError(
            'El usuario se creó, pero los permisos no se pudieron guardar. Edítalos desde la lista.',
          );
          setIsSubmitting(false);
          return;
        }
      }

      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        // Backend throws ConflictException("A user with email X already
        // exists") for a duplicate email — surface next to the field
        // instead of as a raw banner, same pattern as ClientForm.tsx's
        // documentNumber handling.
        if (err.statusCode === 409) {
          setFieldErrors({
            email: 'Ya existe un usuario registrado con este correo.',
          });
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('No se pudo crear el usuario. Intenta de nuevo.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[440px]">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-medium text-white">Nuevo usuario</h2>
        <CloseButton onClick={onClose} />
      </div>

      <p className="mt-1 text-label text-muted">
        Solo administradores pueden crear cuentas — no hay autorregistro.
      </p>

      <div className="mt-5 border-t border-border" />

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3.5">
        <Field label="Nombre completo" error={fieldErrors.fullName}>
          <input
            required
            value={fullName}
            onChange={(event) => {
              setFullName(event.target.value);
              setFieldErrors((prev) => ({ ...prev, fullName: undefined }));
            }}
            placeholder="Ej: Ana Torres"
            className={inputClassName(Boolean(fieldErrors.fullName))}
          />
        </Field>

        <Field label="Correo electrónico" error={fieldErrors.email}>
          <input
            required
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }}
            placeholder="Ej: ana.torres@collectify.com"
            className={inputClassName(Boolean(fieldErrors.email))}
          />
        </Field>

        <Field label="Contraseña" error={fieldErrors.password}>
          <input
            required
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setFieldErrors((prev) => ({ ...prev, password: undefined }));
            }}
            placeholder="Mínimo 8 caracteres"
            className={inputClassName(Boolean(fieldErrors.password))}
          />
        </Field>

        <Field label="Rol">
          <Select
            value={role}
            onChange={(value) => setRole(value as UserRole)}
            options={ROLE_OPTIONS}
            className="w-full"
          />
        </Field>

        {role === 'collector' && (
          <Field label="Módulos que puede ver y usar">
            <ModuleChecklist selected={modules} onChange={setModules} />
            <span className="mt-1 text-meta text-muted">
              Sin ninguno marcado, este cobrador no podrá ver ningún módulo — se
              puede ajustar después desde la lista.
            </span>
          </Field>
        )}

        {formError && (
          <p className="text-small text-danger" role="alert">
            {formError}
          </p>
        )}

        <div className="mt-1.5 border-t border-border" />

        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando…' : 'Guardar usuario'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// inputClassName now lives in @/lib/formStyles — see DESIGN_TOKENS.md's
// "Component-based centralization" section. Field stays local here: its
// layout (no flex-1, always full-width/stacked) differs from the shared
// component's default row layout.

interface FieldProps {
  label: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, error, children }: FieldProps) {
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
