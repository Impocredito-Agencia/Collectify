// Mirrors apps/api/src/whatsapp/smsText.ts exactly — the api decides what is
// really sent; this copy only drives the editor's live counter, so it must
// give the same result. Keep both in sync (each has its own spec).

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

const GSM7_BASIC_SET = new Set(GSM7_BASIC);
const GSM7_EXTENDED_SET = new Set(GSM7_EXTENDED);

const PUNCTUATION_REPLACEMENTS: Record<string, string> = {
  '“': '"',
  '”': '"',
  '«': '"',
  '»': '"',
  '‘': "'",
  '’': "'",
  '´': "'",
  '`': "'",
  '–': '-',
  '—': '-',
  '…': '...',
  '•': '-',
  ' ': ' ',
};

export type SmsEncoding = 'gsm7' | 'ucs2';

export interface SmsSegmentInfo {
  encoding: SmsEncoding;
  length: number;
  segments: number;
}

function isGsm7Char(char: string): boolean {
  return GSM7_BASIC_SET.has(char) || GSM7_EXTENDED_SET.has(char);
}

function toGsm7Char(char: string): string {
  if (isGsm7Char(char)) {
    return char;
  }
  const replacement = PUNCTUATION_REPLACEMENTS[char];
  if (replacement !== undefined) {
    return replacement;
  }
  const withoutMarks = char.normalize('NFD').replace(/\p{M}/gu, '');
  if (withoutMarks.length > 0 && [...withoutMarks].every(isGsm7Char)) {
    return withoutMarks;
  }
  return '';
}

// Every SMS goes out in GSM-7 (accents GSM-7 lacks dropped, emojis removed),
// so a single "días" can't make it cost 2-3 times more.
export function toGsm7Text(text: string): string {
  const converted = [...text.normalize('NFC')].map(toGsm7Char).join('');
  return converted
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function countSmsSegments(text: string): SmsSegmentInfo {
  const chars = [...text];
  if (chars.every(isGsm7Char)) {
    const length = chars.reduce(
      (total, char) => total + (GSM7_EXTENDED_SET.has(char) ? 2 : 1),
      0,
    );
    return {
      encoding: 'gsm7',
      length,
      segments: segmentsFor(length, 160, 153),
    };
  }
  const length = text.length;
  return { encoding: 'ucs2', length, segments: segmentsFor(length, 70, 67) };
}

function segmentsFor(length: number, single: number, multi: number): number {
  if (length === 0) {
    return 0;
  }
  return length <= single ? 1 : Math.ceil(length / multi);
}
