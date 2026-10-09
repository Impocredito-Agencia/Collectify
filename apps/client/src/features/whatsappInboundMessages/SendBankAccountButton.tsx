import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { RowActionButton } from '@/components/ui/RowActionButton';
import { useBankAccount } from '@/features/bankAccount/useBankAccount';
import { useSendBankAccount } from '@/features/whatsappInboundMessages/useWhatsappInboundMessages';
import { ApiError } from '@/lib/apiClient';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface SendBankAccountButtonProps {
  phoneNumber: string;
}

// Human request, 2026-10-09 — sends the cuenta_bancaria Meta template: the
// account the client should pay into. A template, so (like
// SendFollowUpButton) it works at any time, 24h window open or not.
// Nothing goes out until the admin has seen the exact message in the
// dialog and confirmed.
export function SendBankAccountButton({
  phoneNumber,
}: SendBankAccountButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <>
      <RowActionButton onClick={() => setIsDialogOpen(true)}>
        Enviar cuenta bancaria
      </RowActionButton>
      {isDialogOpen && (
        <SendBankAccountDialog
          phoneNumber={phoneNumber}
          onClose={() => setIsDialogOpen(false)}
        />
      )}
    </>
  );
}

interface SendBankAccountDialogProps extends SendBankAccountButtonProps {
  onClose: () => void;
}

function SendBankAccountDialog({
  phoneNumber,
  onClose,
}: SendBankAccountDialogProps) {
  // The preview is the API's own rendering of the template with the
  // account on file — the same text the send below delivers.
  const { data: setting, isLoading, isError } = useBankAccount();
  const sendBankAccount = useSendBankAccount();
  const messagePreview = setting?.messagePreview ?? null;

  useEscapeKey(onClose);

  const handleConfirm = () => {
    sendBankAccount.mutate(phoneNumber, {
      onSuccess: (sent) => {
        if (sent) onClose();
      },
    });
  };

  return (
    <Modal maxWidth="max-w-[460px]">
      <h2 className="text-[16px] font-medium text-white">
        Enviar cuenta bancaria
      </h2>
      <p className="mt-2.5 text-small text-muted">
        Envía la plantilla de Meta «cuenta_bancaria». Llega aunque ya hayan
        pasado las 24 horas desde el último mensaje del cliente. Revisa el
        mensaje antes de enviarlo:
      </p>

      {isLoading && <p className="mt-4 text-small text-muted">Cargando…</p>}
      {isError && (
        <p className="mt-4 text-small text-danger" role="alert">
          No se pudo cargar la cuenta bancaria. Intenta de nuevo.
        </p>
      )}
      {!isLoading && !isError && !messagePreview && (
        <p className="mt-4 text-small text-warning" role="alert">
          Todavía no hay una cuenta bancaria configurada. Ingrésala en
          «Plantillas de mensaje» para poder enviarla.
        </p>
      )}
      {messagePreview && (
        <div className="mt-4 rounded-lg bg-white/10 px-3.5 py-2.5">
          <p className="whitespace-pre-wrap text-small text-white">
            {messagePreview}
          </p>
        </div>
      )}

      {sendBankAccount.isError && (
        <p className="mt-3 text-small text-danger" role="alert">
          {sendBankAccount.error instanceof ApiError
            ? sendBankAccount.error.message
            : 'No se pudo enviar la cuenta bancaria. Intenta de nuevo.'}
        </p>
      )}
      {sendBankAccount.isSuccess && sendBankAccount.data === false && (
        <p className="mt-3 text-small text-danger" role="alert">
          WhatsApp no confirmó el envío — revise las credenciales de Meta o que
          la plantilla esté aprobada.
        </p>
      )}

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={sendBankAccount.isPending}
        >
          Cancelar
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={!messagePreview || sendBankAccount.isPending}
        >
          {sendBankAccount.isPending ? 'Enviando…' : 'Enviar cuenta bancaria'}
        </Button>
      </div>
    </Modal>
  );
}
