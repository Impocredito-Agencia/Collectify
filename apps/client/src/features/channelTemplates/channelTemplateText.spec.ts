import { describe, expect, it } from 'vitest';

import {
  fillPlaceholders,
  findInvalidPlaceholders,
  MESSAGE_TYPE_GROUPS,
  splitBold,
  splitParagraphs,
} from '@/features/channelTemplates/channelTemplateText';
import {
  MessageType,
  NEW_LOAN_FAMILY_TYPES,
} from '@/features/messageTemplates/messageTemplatesApi';

describe('fillPlaceholders', () => {
  it('fills every occurrence and leaves unknown numbers as they are', () => {
    expect(fillPlaceholders('{{1}} y {{1}}, {{3}}', ['a', 'b'])).toBe(
      'a y a, {{3}}',
    );
  });
});

describe('findInvalidPlaceholders', () => {
  it('flags numbers out of range and malformed placeholders', () => {
    expect(findInvalidPlaceholders('{{1}} {{3}}', 3)).toEqual([]);
    expect(findInvalidPlaceholders('{{4}} {{0}}', 3)).toEqual([
      '{{4}}',
      '{{0}}',
    ]);
    expect(findInvalidPlaceholders('{{ 1 }} {{nombre}} {{2', 3)).toEqual([
      '{{ 1 }}',
      '{{nombre}}',
      '{{2',
    ]);
  });
});

describe('splitBold', () => {
  it('splits a line on its *bold* markers', () => {
    expect(splitBold('Hola *Juana*, pague *hoy*.')).toEqual([
      { text: 'Hola ', isBold: false },
      { text: 'Juana', isBold: true },
      { text: ', pague ', isBold: false },
      { text: 'hoy', isBold: true },
      { text: '.', isBold: false },
    ]);
  });

  it('keeps a lone asterisk as text', () => {
    expect(splitBold('5 * 3')).toEqual([{ text: '5 * 3', isBold: false }]);
  });
});

describe('splitParagraphs', () => {
  it('splits on blank lines and drops empty ones', () => {
    expect(splitParagraphs('\nUno\nsigue\n\n\n  Dos  \n')).toEqual([
      'Uno\nsigue',
      'Dos',
    ]);
  });
});

describe('MESSAGE_TYPE_GROUPS', () => {
  it("follows a loan's life: próximas, vencidas, Datacrédito", () => {
    expect(MESSAGE_TYPE_GROUPS.map((group) => group.label)).toEqual([
      'Cuotas próximas a vencer',
      'Cuotas vencidas',
      'Reporte a Datacrédito',
    ]);
  });

  it('lists every collection type once, and no new-loan or payment type', () => {
    const listed = MESSAGE_TYPE_GROUPS.flatMap((group) => group.types);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toHaveLength(11);
    for (const type of [
      ...NEW_LOAN_FAMILY_TYPES,
      MessageType.PaymentConfirmation,
      MessageType.PaidInFull,
    ]) {
      expect(listed).not.toContain(type);
    }
  });
});
