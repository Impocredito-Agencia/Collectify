import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { RowActionButton } from '@/components/ui/RowActionButton';
import { useSendFollowUp } from '@/features/whatsappInboundMessages/useWhatsappInboundMessages';
import { ApiError } from '@/lib/apiClient';
import { useEscapeKey } from '@/lib/useEscapeKey';

// Must match apps/api's FOLLOW_UP_UNKNOWN_NAME — the API picks the real
// {{1}} value itself, this only mirrors it for the preview.
const UNKNOWN_CLIENT_GREETING_NAME = 'Señor(a)';

interface SendFollowUpButtonProps {
  phoneNumber: string;
  // Null for an unrecognized number — the template then greets them as
  // "Señor(a)".
  clientName: string | null;
}

// Human report, 2026-09-24 — once a client's 24h session window closes,
// "Responder" can no longer reach them; only an approved Meta template
// can. This sends the seguimiento_solicitud template so their reply
// reopens the window. Available on every conversation, known client or
// not.
export function SendFollowUpButton({
  phoneNumber,
  clientName,
}: SendFollowUpButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <>
      <RowActionButton onClick={() => setIsDialogOpen(true)}>
        Enviar seguimiento
      </RowActionButton>
      {isDialogOpen && (
        <SendFollowUpDialog
          phoneNumber={phoneNumber}
          clientName={clientName}
          onClose={() => setIsDialogOpen(false)}
        />
      )}
    </>
  );
}

interface SendFollowUpDialogProps extends SendFollowUpButtonProps {
  onClose: () => void;
}

function SendFollowUpDialog({
  phoneNumber,
  clientName,
  onClose,
}: SendFollowUpDialogProps) {
  const sendFollowUp = useSendFollowUp();
  const greetingName = clientName?.trim() || UNKNOWN_CLIENT_GREETING_NAME;

  useEscapeKey(onClose);

  const handleConfirm = () => {
    sendFollowUp.mutate(phoneNumber, {
      onSuccess: (sent) => {
        if (sent) onClose();
      },
    });
  };

  return (
    <Modal maxWidth="max-w-[420px]">
      <h2 className="text-[16px] font-medium text-white">Enviar seguimiento</h2>
      <p className="mt-2.5 text-small text-muted">
        Envía la plantilla de Meta «seguimiento_solicitud». Sirve aunque ya
        hayan pasado las 24 horas desde el último mensaje del cliente: cuando
        responda, podrá seguir la conversación normalmente.
      </p>

      <div className="mt-4 rounded-lg bg-white/10 px-3.5 py-2.5">
        <p className="whitespace-pre-wrap text-small text-white">
          {`Cordial saludo, ${greetingName}.\n\nSeguimos atentos a su solicitud con IMPROCRÉDITO. Por favor, respóndanos a este mensaje para que un asesor pueda continuar ayudándole. 🤝`}
        </p>
      </div>

      {sendFollowUp.isError && (
        <p className="mt-3 text-small text-danger" role="alert">
          {sendFollowUp.error instanceof ApiError
            ? sendFollowUp.error.message
            : 'No se pudo enviar el seguimiento. Intenta de nuevo.'}
        </p>
      )}
      {sendFollowUp.isSuccess && sendFollowUp.data === false && (
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
          disabled={sendFollowUp.isPending}
        >
          Cancelar
        </Button>
        <Button onClick={handleConfirm} disabled={sendFollowUp.isPending}>
          {sendFollowUp.isPending ? 'Enviando…' : 'Enviar seguimiento'}
        </Button>
      </div>
    </Modal>
  );
}
