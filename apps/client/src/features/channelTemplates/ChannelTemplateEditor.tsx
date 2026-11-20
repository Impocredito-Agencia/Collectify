import { useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CloseButton } from '@/components/ui/CloseButton';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { BrevoChannel } from '@/features/brevo/brevoApi';
import {
  EMAIL_BODY_MAX_LENGTH,
  EMAIL_SUBJECT_MAX_LENGTH,
  SMS_BODY_MAX_LENGTH,
} from '@/features/channelTemplates/channelTemplatesApi';
import { findInvalidPlaceholders } from '@/features/channelTemplates/channelTemplateText';
import {
  EmailPreview,
  SmsPreview,
} from '@/features/channelTemplates/ChannelTemplatePreview';
import { ChannelTemplateTestSend } from '@/features/channelTemplates/ChannelTemplateTestSend';
import { useUpdateChannelTemplate } from '@/features/channelTemplates/useChannelTemplates';
import { MESSAGE_TYPE_LABELS } from '@/features/messageTemplates/messageTemplatesApi';
import { ApiError } from '@/lib/apiClient';
import { inputClassName } from '@/lib/formStyles';

import type { ChannelTemplate } from '@/features/channelTemplates/channelTemplatesApi';

interface ChannelTemplateEditorProps {
  template: ChannelTemplate;
  onClose: () => void;
}

const TEXTAREA_CLASS =
  'w-full resize-y rounded border bg-input px-3.5 py-2 text-control text-white placeholder-mid focus:outline-none';

// Phase 36, stage 2 — edits one email or SMS template. {{n}} placeholders
// are inserted from the parameter list (not typed by hand), and the
// preview fills them with the same example values the api uses for a
// template test send.
export function ChannelTemplateEditor({
  template,
  onClose,
}: ChannelTemplateEditorProps) {
  const updateTemplate = useUpdateChannelTemplate();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [subject, setSubject] = useState(template.subject ?? '');
  const [body, setBody] = useState(template.body);
  const [formError, setFormError] = useState<string | null>(null);

  const isSms = template.channel === BrevoChannel.Sms;
  const parameterCount = template.parameters.length;
  const invalidPlaceholders = [
    ...new Set([
      ...findInvalidPlaceholders(subject, parameterCount),
      ...findInvalidPlaceholders(body, parameterCount),
    ]),
  ];
  const hasChanges =
    body !== template.body || (!isSms && subject !== (template.subject ?? ''));

  const insertPlaceholder = (index: number) => {
    const placeholder = `{{${index + 1}}}`;
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + placeholder + body.slice(end));
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(
        start + placeholder.length,
        start + placeholder.length,
      );
    });
  };

  const handleSave = () => {
    setFormError(null);
    if (!body.trim() || (!isSms && !subject.trim())) {
      setFormError(
        isSms ? 'Escribe el texto del SMS.' : 'Escribe el asunto y el texto.',
      );
      return;
    }
    updateTemplate.mutate(
      {
        type: template.type,
        channel: template.channel,
        subject: isSms ? null : subject,
        body,
      },
      {
        onError: (err) =>
          setFormError(
            err instanceof ApiError
              ? err.message
              : 'No se pudo guardar la plantilla.',
          ),
      },
    );
  };

  return (
    // 1440px = 50% wider than the first version (human request,
    // 2026-11-09), capped to the viewport minus a 1rem gutter per side so
    // it never touches the screen edges on a smaller laptop.
    <Modal maxWidth="max-w-[min(1440px,calc(100vw-2rem))]" scroll>
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-card-title font-medium text-white">
              {isSms ? 'SMS' : 'Correo'} · {MESSAGE_TYPE_LABELS[template.type]}
            </span>
            <span className="text-meta text-muted">
              Los cambios aplican desde el siguiente envío.
            </span>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-3.5">
            {!isSms && (
              <Field label="Asunto" layout="stack">
                <input
                  type="text"
                  value={subject}
                  maxLength={EMAIL_SUBJECT_MAX_LENGTH}
                  onChange={(event) => setSubject(event.target.value)}
                  className={inputClassName(false)}
                />
              </Field>
            )}
            <Field
              label={isSms ? 'Texto del SMS' : 'Texto del correo'}
              layout="stack"
            >
              <textarea
                ref={bodyRef}
                value={body}
                maxLength={isSms ? SMS_BODY_MAX_LENGTH : EMAIL_BODY_MAX_LENGTH}
                onChange={(event) => setBody(event.target.value)}
                rows={isSms ? 5 : 14}
                className={`${TEXTAREA_CLASS} ${invalidPlaceholders.length > 0 ? 'border-danger' : 'border-border focus:border-subtle'}`}
              />
            </Field>
            {!isSms && (
              <p className="text-meta text-muted">
                *texto* sale en negrita. Una línea en blanco separa párrafos.
              </p>
            )}
            {invalidPlaceholders.length > 0 && (
              <p className="text-small text-danger" role="alert">
                Marcadores no válidos: {invalidPlaceholders.join(', ')}. Este
                mensaje solo admite {'{{1}}'} a {`{{${parameterCount}}}`}.
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-muted">
                Datos disponibles — clic para insertarlos en el texto
              </span>
              <div className="flex flex-col gap-1">
                {template.parameters.map((parameter, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => insertPlaceholder(index)}
                    className="flex items-baseline gap-2 rounded px-2 py-1 text-left text-meta hover:bg-white/[0.05]"
                  >
                    <code className="shrink-0 text-strong">{`{{${index + 1}}}`}</code>
                    <span className="text-muted">
                      {parameter.label} — ej. «{parameter.example}»
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] text-muted">
              Vista previa con datos de ejemplo
            </span>
            {isSms ? (
              <SmsPreview body={body} parameters={template.parameters} />
            ) : (
              <EmailPreview
                subject={subject}
                body={body}
                parameters={template.parameters}
              />
            )}
          </div>
        </div>

        {formError && (
          <p className="text-small text-danger" role="alert">
            {formError}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {hasChanges ? 'Descartar' : 'Cerrar'}
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !hasChanges ||
              invalidPlaceholders.length > 0 ||
              updateTemplate.isPending
            }
          >
            {updateTemplate.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>

        <ChannelTemplateTestSend
          type={template.type}
          channel={template.channel}
          hasUnsavedChanges={hasChanges}
        />
      </div>
    </Modal>
  );
}
