import { MessageType } from '@/features/messageTemplates/messageTemplatesApi';
import {
  CREDIT_REPORT_FAMILY_TYPES,
  NEW_LOAN_FAMILY_TYPES,
  OVERDUE_FAMILY_TYPES,
} from '@/features/messageTemplates/messageTemplatesApi';

const PLACEHOLDER_PATTERN = /\{\{(\d+)\}\}/g;

// Same {{n}} substitution as the api's renderTemplateBody — only used here
// for the editor's preview with example values.
export function fillPlaceholders(text: string, values: string[]): string {
  return text.replace(PLACEHOLDER_PATTERN, (match, number: string) => {
    const value = values[Number(number) - 1];
    return value ?? match;
  });
}

// Mirrors the api's findInvalidPlaceholders (channelTemplateText.ts) so the
// editor can flag a bad placeholder before saving; the api checks again.
export function findInvalidPlaceholders(
  text: string,
  parameterCount: number,
): string[] {
  const invalid: string[] = [];
  const withoutValid = text.replace(
    PLACEHOLDER_PATTERN,
    (match, number: string) => {
      const index = Number(number);
      if (index < 1 || index > parameterCount) {
        invalid.push(match);
      }
      return '';
    },
  );
  const leftovers = withoutValid.match(/\{\{[^}]*\}?\}?|\}\}/g) ?? [];
  return [...invalid, ...leftovers];
}

export interface EmailSegment {
  text: string;
  isBold: boolean;
}

// Splits one line of an email body on its *bold* markers, the same way the
// api's renderEmailHtml does, so the preview can render it with React
// elements instead of injecting HTML.
export function splitBold(line: string): EmailSegment[] {
  const segments: EmailSegment[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(/\*([^*\n]+)\*/g)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, index), isBold: false });
    }
    segments.push({ text: match[1], isBold: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), isBold: false });
  }
  return segments;
}

export function splitParagraphs(text: string): string[] {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export interface MessageTypeGroup {
  label: string;
  types: MessageType[];
}

// How the editor lists the 18 message types — by what triggers them.
export const MESSAGE_TYPE_GROUPS: MessageTypeGroup[] = [
  { label: 'Nuevo pagaré / Refinanciación', types: NEW_LOAN_FAMILY_TYPES },
  {
    label: 'Cuotas próximas a vencer',
    types: [
      MessageType.SingleUpcomingInstallment,
      MessageType.MultipleUpcomingInstallments,
    ],
  },
  { label: 'Cuotas vencidas', types: OVERDUE_FAMILY_TYPES },
  { label: 'Reporte a Datacrédito', types: CREDIT_REPORT_FAMILY_TYPES },
  {
    label: 'Pagos',
    types: [MessageType.PaymentConfirmation, MessageType.PaidInFull],
  },
];
