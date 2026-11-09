import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { FilterTab } from '@/components/ui/FilterTab';
import { BrevoChannel } from '@/features/brevo/brevoApi';
import { describeSendFailure } from '@/features/brevo/brevoLabels';
import { useSendBrevoTest } from '@/features/brevo/useBrevo';
import { ApiError } from '@/lib/apiClient';
import { EMAIL_REGEX } from '@/lib/emailPattern';
import { inputClassName } from '@/lib/formStyles';

import type { BrevoSendResult } from '@/features/brevo/brevoApi';
import type { FormEvent } from 'react';

interface SentResult {
  channel: BrevoChannel;
  result: BrevoSendResult;
}

// Phase 36 — the text is fixed server-side; the admin only picks where it
// goes. An SMS spends a real credit, hence the warning under the field.
export function BrevoTestSendForm() {
  const sendTest = useSendBrevoTest();
  const [channel, setChannel] = useState<BrevoChannel>(BrevoChannel.Email);
  const [to, setTo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SentResult | null>(null);

  const isSms = channel === BrevoChannel.Sms;

  const selectChannel = (next: BrevoChannel) => {
    setChannel(next);
    setTo('');
    setFormError(null);
    setLastResult(null);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setLastResult(null);

    const value = to.trim();
    if (!value) {
      setFormError(isSms ? 'Ingresa un celular.' : 'Ingresa un correo.');
      return;
    }
    if (!isSms && !EMAIL_REGEX.test(value)) {
      setFormError('Ingresa un correo válido.');
      return;
    }

    sendTest.mutate(
      { channel, to: value },
      {
        onSuccess: (result) => setLastResult({ channel, result }),
        onError: (err) =>
          setFormError(
            err instanceof ApiError
              ? err.message
              : 'No se pudo hacer el envío de prueba. Intenta de nuevo.',
          ),
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <span className="text-small font-medium text-white">Envío de prueba</span>
      <div className="flex gap-2">
        <FilterTab
          label="Correo"
          isActive={!isSms}
          onClick={() => selectChannel(BrevoChannel.Email)}
        />
        <FilterTab
          label="SMS"
          isActive={isSms}
          onClick={() => selectChannel(BrevoChannel.Sms)}
        />
      </div>

      <Field
        label={isSms ? 'Celular' : 'Correo'}
        error={formError ?? undefined}
        layout="stack"
      >
        <input
          // Not type="email": the browser's own check rejects accented
          // addresses the api accepts — see lib/emailPattern.ts.
          type={isSms ? 'tel' : 'text'}
          inputMode={isSms ? 'tel' : 'email'}
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder={isSms ? '300 123 4567' : 'nombre@ejemplo.com'}
          className={inputClassName(Boolean(formError))}
        />
      </Field>

      <p className="text-meta text-muted">
        {isSms
          ? 'Se envía un SMS corto de prueba. Consume 1 crédito de Brevo si sale.'
          : 'Se envía un correo corto de prueba.'}
      </p>

      {lastResult && (
        <p
          role="status"
          className={`text-small ${lastResult.result.sent ? 'text-success' : 'text-danger'}`}
        >
          {lastResult.result.sent
            ? `Enviado. Brevo lo aceptó${lastResult.result.providerMessageId ? ` (id ${lastResult.result.providerMessageId})` : ''}; puede tardar unos segundos en llegar.`
            : `No se envió. ${describeSendFailure(lastResult.result.failureReason, lastResult.channel)}${lastResult.result.errorMessage ? ` Detalle: ${lastResult.result.errorMessage}` : ''}`}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={sendTest.isPending}>
          {sendTest.isPending ? 'Enviando…' : 'Enviar prueba'}
        </Button>
      </div>
    </form>
  );
}
