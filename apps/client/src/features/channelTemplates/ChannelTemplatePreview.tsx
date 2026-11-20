import {
  fillPlaceholders,
  splitBold,
  splitParagraphs,
} from '@/features/channelTemplates/channelTemplateText';
import {
  countSmsSegments,
  toGsm7Text,
} from '@/features/channelTemplates/smsText';

import type { MessageTypeParameter } from '@/features/channelTemplates/channelTemplatesApi';

interface EmailPreviewProps {
  subject: string;
  body: string;
  parameters: MessageTypeParameter[];
}

const examples = (parameters: MessageTypeParameter[]) =>
  parameters.map((parameter) => parameter.example);

// Rendered with React elements, never as injected HTML — the same
// paragraph/line/bold rules the api's renderEmailHtml applies. A soft
// light gray "paper" with near-black text (the `paper` tokens): it reads as
// the email itself without the pure white of a real inbox, which flashed
// too hard in an all-dark app (human request, 2026-11-09).
export function EmailPreview({ subject, body, parameters }: EmailPreviewProps) {
  const values = examples(parameters);
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-paper px-4 py-3 text-[14px] leading-relaxed text-paper-ink">
      <span className="border-b border-paper-line pb-2 font-semibold">
        {fillPlaceholders(subject, values) || '(sin asunto)'}
      </span>
      {splitParagraphs(fillPlaceholders(body, values)).map(
        (paragraph, paragraphIndex) => (
          <p key={paragraphIndex}>
            {paragraph.split('\n').map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 && <br />}
                {splitBold(line).map((segment, segmentIndex) =>
                  segment.isBold ? (
                    <strong key={segmentIndex}>{segment.text}</strong>
                  ) : (
                    <span key={segmentIndex}>{segment.text}</span>
                  ),
                )}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

interface SmsPreviewProps {
  body: string;
  parameters: MessageTypeParameter[];
}

export function SmsPreview({ body, parameters }: SmsPreviewProps) {
  const text = toGsm7Text(fillPlaceholders(body, examples(parameters)));
  const { length, segments } = countSmsSegments(text);
  const tone =
    segments <= 1
      ? 'text-success'
      : segments === 2
        ? 'text-warning'
        : 'text-danger';

  return (
    <div className="flex flex-col gap-2">
      <p className="whitespace-pre-line rounded-lg bg-white/10 px-3.5 py-2.5 text-small text-white">
        {text || '(vacío)'}
      </p>
      <p className={`text-label ${tone}`} role="status">
        {length} caracteres · {segments}{' '}
        {segments === 1 ? 'crédito' : 'créditos'} por envío con estos datos de
        ejemplo
        {segments > 1 && ' — cada 153 caracteres extra suma un crédito'}
      </p>
      <p className="text-label text-muted">
        Así sale el SMS: sin tildes en á, í, ó, ú ni emojis, para que cada
        crédito alcance para 160 caracteres. Un nombre o valor más largo que el
        del ejemplo puede sumar un crédito.
      </p>
    </div>
  );
}
