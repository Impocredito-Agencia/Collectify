import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { BrevoChannel } from '@/features/brevo/brevoApi';
import { describeSendFailure } from '@/features/brevo/brevoLabels';
import { useSendChannelTemplateTest } from '@/features/channelTemplates/useChannelTemplates';
import { ApiError } from '@/lib/apiClient';
import { inputClassName } from '@/lib/formStyles';

import type { BrevoSendResult } from '@/features/brevo/brevoApi';
import type { MessageType } from '@/features/messageTemplates/messageTemplatesApi';

interface ChannelTemplateTestSendProps {
  type: MessageType;
  channel: BrevoChannel;
  // The test sends the SAVED template, so it's disabled while the editor
  // has unsaved changes.
  hasUnsavedChanges: boolean;
}

export function ChannelTemplateTestSend({
  type,
  channel,
  hasUnsavedChanges,
}: ChannelTemplateTestSendProps) {
  const sendTest = useSendChannelTemplateTest();
  const [to, setTo] = useState('');
  const [result, setResult] = useState<BrevoSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSms = channel === BrevoChannel.Sms;

  const handleSend = () => {
    setResult(null);
    setError(null);
    sendTest.mutate(
      { type, channel, to: to.trim() },
      {
        onSuccess: setResult,
        onError: (err) =>
          setError(
            err instanceof ApiError
              ? err.message
              : 'No se pudo hacer el envío de prueba.',
          ),
      },
    );
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-small font-medium text-white">
        Probar esta plantilla
      </span>
      <p className="text-meta text-muted">
        Envía la versión guardada con los datos de ejemplo.
        {isSms && ' Consume créditos de Brevo si sale.'}
      </p>
      <div className="flex gap-2">
        <input
          type={isSms ? 'tel' : 'text'}
          inputMode={isSms ? 'tel' : 'email'}
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder={isSms ? '300 123 4567' : 'nombre@ejemplo.com'}
          className={inputClassName(Boolean(error))}
        />
        <Button
          variant="secondary"
          onClick={handleSend}
          disabled={!to.trim() || hasUnsavedChanges || sendTest.isPending}
          title={hasUnsavedChanges ? 'Guarda los cambios primero' : undefined}
        >
          {sendTest.isPending ? 'Enviando…' : 'Enviar'}
        </Button>
      </div>
      {hasUnsavedChanges && (
        <p className="text-meta text-warning">
          Guarda los cambios para poder probarlos.
        </p>
      )}
      {error && (
        <p className="text-small text-danger" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p
          role="status"
          className={`text-small ${result.sent ? 'text-success' : 'text-danger'}`}
        >
          {result.sent
            ? 'Enviado. Puede tardar unos segundos en llegar.'
            : `No se envió. ${describeSendFailure(result.failureReason, channel)}${result.errorMessage ? ` Detalle: ${result.errorMessage}` : ''}`}
        </p>
      )}
    </div>
  );
}
