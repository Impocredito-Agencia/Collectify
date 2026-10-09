import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { BANK_ACCOUNT_MAX_LENGTH } from '@/features/bankAccount/bankAccountApi';
import {
  useBankAccount,
  useUpdateBankAccount,
} from '@/features/bankAccount/useBankAccount';
import { ApiError } from '@/lib/apiClient';
import { inputClassName } from '@/lib/formStyles';

import type { FormEvent } from 'react';

// Human request, 2026-10-09 — where an admin sets the account the
// cuenta_bancaria template sends (the inbox's "Enviar cuenta bancaria"
// button). The business changes accounts from time to time, so it's
// editable here rather than fixed in code; the template's own wording
// stays fixed like every other Meta-approved template on this page.
export function BankAccountCard() {
  const { data: setting, isLoading, isError } = useBankAccount();
  const updateBankAccount = useUpdateBankAccount();
  // Null until the admin types — the field shows the saved account
  // meanwhile, without copying it into state from an effect.
  const [draft, setDraft] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const savedBankAccount = setting?.bankAccount ?? '';
  const value = draft ?? savedBankAccount;
  const hasChanges = value.trim() !== savedBankAccount;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!value.trim()) {
      setFormError('Ingresa la cuenta bancaria.');
      return;
    }

    updateBankAccount.mutate(value, {
      onSuccess: () => setDraft(null),
      onError: (err) =>
        setFormError(
          err instanceof ApiError
            ? err.message
            : 'No se pudo guardar la cuenta bancaria. Intenta de nuevo.',
        ),
    });
  };

  return (
    <div className="flex flex-col gap-3.5 rounded bg-surface p-5">
      <div className="flex flex-col gap-1">
        <span className="text-card-title font-medium text-white">
          Cuenta bancaria para pagos
        </span>
        <p className="text-small text-muted">
          Es la cuenta que recibe el cliente con el botón «Enviar cuenta
          bancaria» de la bandeja de WhatsApp (plantilla «cuenta_bancaria»). Si
          cambia la cuenta, actualízala aquí: aplica desde el siguiente envío.
        </p>
      </div>

      {isLoading && <p className="text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="text-small text-danger" role="alert">
          No se pudo cargar la cuenta bancaria.
        </p>
      )}

      {!isLoading && !isError && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <Field
            label="Cuenta bancaria o llave BRE-B"
            error={formError ?? undefined}
            layout="stack"
          >
            <input
              type="text"
              value={value}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={BANK_ACCOUNT_MAX_LENGTH}
              placeholder="Cuenta de Ahorros Bancolombia No. 000-000000-00 / Nombre del titular"
              className={inputClassName(Boolean(formError))}
            />
          </Field>

          {!setting?.bankAccount && (
            <p className="text-small text-warning" role="status">
              Todavía no hay una cuenta configurada — no se podrá enviar hasta
              que guardes una.
            </p>
          )}

          {setting?.messagePreview && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-normal tracking-normal text-muted">
                Mensaje que recibe el cliente hoy
              </span>
              <p className="whitespace-pre-line rounded-lg bg-white/10 px-3.5 py-2.5 text-small text-white">
                {setting.messagePreview}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-meta text-muted">
              {setting?.updatedAt
                ? `Última actualización: ${new Date(setting.updatedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}`
                : ''}
            </span>
            <Button
              type="submit"
              disabled={!hasChanges || updateBankAccount.isPending}
            >
              {updateBankAccount.isPending ? 'Guardando…' : 'Guardar cuenta'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
