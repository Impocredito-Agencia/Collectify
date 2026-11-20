import { describe, expect, it } from 'vitest';

import {
  countSmsSegments,
  toGsm7Text,
} from '@/features/channelTemplates/smsText';

// Same cases as apps/api/src/whatsapp/smsText.spec.ts — both copies must
// agree.
describe('toGsm7Text', () => {
  it('drops the accents GSM-7 lacks and keeps the ones it has', () => {
    expect(toGsm7Text('Vence en 3 días, cuota del pagaré, mañana')).toBe(
      'Vence en 3 dias, cuota del pagaré, mañana',
    );
    expect(toGsm7Text('ÁÍÓÚ áíóú É Ñ ü ¿¡')).toBe('AIOU aiou É Ñ ü ¿¡');
  });

  it('replaces typographic punctuation and removes emojis', () => {
    expect(toGsm7Text('“Hola” – it’s… 📆')).toBe('"Hola" - it\'s...');
  });

  it('always produces GSM-7 text', () => {
    const text = toGsm7Text('Señor/a María José — ¡vence hoy! 🚨 €5');
    expect(countSmsSegments(text).encoding).toBe('gsm7');
  });
});

describe('countSmsSegments', () => {
  it('fits 160 GSM-7 characters in one segment, then 153 per segment', () => {
    expect(countSmsSegments('a'.repeat(160)).segments).toBe(1);
    expect(countSmsSegments('a'.repeat(161)).segments).toBe(2);
    expect(countSmsSegments('a'.repeat(307)).segments).toBe(3);
  });

  it('counts extended characters twice', () => {
    expect(countSmsSegments('€'.repeat(81))).toMatchObject({
      length: 162,
      segments: 2,
    });
  });

  it('switches to UCS-2 for an accent outside GSM-7', () => {
    expect(countSmsSegments('días')).toEqual({
      encoding: 'ucs2',
      length: 4,
      segments: 1,
    });
    expect(countSmsSegments('í' + 'a'.repeat(70)).segments).toBe(2);
  });

  it('reports no segments for an empty text', () => {
    expect(countSmsSegments('').segments).toBe(0);
  });
});
