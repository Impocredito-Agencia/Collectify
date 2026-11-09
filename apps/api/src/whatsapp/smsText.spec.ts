import { countSmsSegments, toGsm7Text } from './smsText';

describe('toGsm7Text', () => {
  it('drops the accents GSM-7 lacks and keeps the ones it has', () => {
    expect(toGsm7Text('Vence en 3 días, cuota del pagaré, mañana')).toBe(
      'Vence en 3 dias, cuota del pagaré, mañana',
    );
    expect(toGsm7Text('ÁÍÓÚ áíóú É Ñ ü ¿¡')).toBe('AIOU aiou É Ñ ü ¿¡');
  });

  it('replaces typographic punctuation', () => {
    expect(toGsm7Text('“Hola” – it’s…')).toBe('"Hola" - it\'s...');
  });

  it('removes emojis and tidies the spaces they leave', () => {
    expect(toGsm7Text('Pague a tiempo. 📆\nGracias 🤝 hoy')).toBe(
      'Pague a tiempo.\nGracias hoy',
    );
  });

  it('handles decomposed accents', () => {
    expect(toGsm7Text('días')).toBe('dias');
  });

  it('always produces GSM-7 text', () => {
    const text = toGsm7Text('Señor/a María José Gómez — ¡vence hoy! 🚨 €5 {x}');
    expect(countSmsSegments(text).encoding).toBe('gsm7');
  });
});

describe('countSmsSegments', () => {
  it('fits 160 GSM-7 characters in one segment', () => {
    expect(countSmsSegments('a'.repeat(160))).toEqual({
      encoding: 'gsm7',
      length: 160,
      segments: 1,
    });
  });

  it('splits longer GSM-7 text in 153-character segments', () => {
    expect(countSmsSegments('a'.repeat(161)).segments).toBe(2);
    expect(countSmsSegments('a'.repeat(306)).segments).toBe(2);
    expect(countSmsSegments('a'.repeat(307)).segments).toBe(3);
  });

  it('counts extended characters twice', () => {
    expect(countSmsSegments('€'.repeat(80))).toMatchObject({
      length: 160,
      segments: 1,
    });
    expect(countSmsSegments('€'.repeat(81)).segments).toBe(2);
  });

  it('switches to UCS-2 for a single accent outside GSM-7', () => {
    expect(countSmsSegments('días')).toEqual({
      encoding: 'ucs2',
      length: 4,
      segments: 1,
    });
    expect(countSmsSegments('í' + 'a'.repeat(70)).segments).toBe(2);
    expect(countSmsSegments('í' + 'a'.repeat(133)).segments).toBe(2);
    expect(countSmsSegments('í' + 'a'.repeat(134)).segments).toBe(3);
  });

  it('reports no segments for an empty text', () => {
    expect(countSmsSegments('').segments).toBe(0);
  });
});
