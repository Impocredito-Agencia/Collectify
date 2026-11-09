// GSM 03.38 — the alphabet an SMS can use while staying at 160 characters
// per segment. Note it has é, ñ, ü, ¿ and ¡ but NOT á, í, ó or ú.
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
// Allowed too, but each one takes two of the 160 characters.
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

const GSM7_SINGLE_SEGMENT = 160;
const GSM7_MULTI_SEGMENT = 153;
const UCS2_SINGLE_SEGMENT = 70;
const UCS2_MULTI_SEGMENT = 67;

export type SmsEncoding = 'gsm7' | 'ucs2';

export interface SmsSegmentInfo {
  encoding: SmsEncoding;
  // Characters as the carrier counts them: GSM-7 extended characters count
  // twice; in UCS-2, each UTF-16 unit counts once.
  length: number;
  // What Brevo charges: one credit per segment.
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
  // á → a, Í → I, ç → c ... — the letter without its accent mark.
  const withoutMarks = char.normalize('NFD').replace(/\p{M}/gu, '');
  if (withoutMarks.length > 0 && [...withoutMarks].every(isGsm7Char)) {
    return withoutMarks;
  }
  // Emojis and anything else with no GSM-7 equivalent.
  return '';
}

// Phase 36 — confirmed with the human (2026-11-09): every SMS is sent in
// GSM-7, so one accented word ("días") can't turn the whole message into
// UCS-2 (70 characters per credit instead of 160). Only the SMS is
// rewritten; WhatsApp and email keep their accents.
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
      segments: segmentsFor(length, GSM7_SINGLE_SEGMENT, GSM7_MULTI_SEGMENT),
    };
  }

  const length = text.length;
  return {
    encoding: 'ucs2',
    length,
    segments: segmentsFor(length, UCS2_SINGLE_SEGMENT, UCS2_MULTI_SEGMENT),
  };
}

function segmentsFor(length: number, single: number, multi: number): number {
  if (length === 0) {
    return 0;
  }
  return length <= single ? 1 : Math.ceil(length / multi);
}
