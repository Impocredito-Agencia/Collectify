import {
  buildBankAccountTemplateMessage,
  normalizeBankAccount,
} from './bankAccountTemplate';

describe('normalizeBankAccount', () => {
  it('trims the value', () => {
    expect(normalizeBankAccount('  Nequi 3001234567  ')).toBe(
      'Nequi 3001234567',
    );
  });

  it('flattens line breaks, tabs and repeated spaces to single spaces', () => {
    expect(
      normalizeBankAccount(
        'Cuenta de Ahorros Bancolombia\nNo. 123-456\t/     Alejandro Martinez',
      ),
    ).toBe('Cuenta de Ahorros Bancolombia No. 123-456 / Alejandro Martinez');
  });

  it('returns an empty string for a blank value', () => {
    expect(normalizeBankAccount(' \n ')).toBe('');
  });
});

describe('buildBankAccountTemplateMessage', () => {
  it('uses the bank account for {{1}} and renders the full body', () => {
    const result = buildBankAccountTemplateMessage(
      'Cuenta de Ahorros Bancolombia No. 123123-5235-23535/ Alejandro Martinez',
    );

    expect(result.bodyParameters).toEqual([
      'Cuenta de Ahorros Bancolombia No. 123123-5235-23535/ Alejandro Martinez',
    ]);
    expect(result.messageContent).toBe(
      'Podrás enviar el dinero de tu cuota a la siguiente cuenta bancaria, o llave BRE-B, es muy importante que leas y escribas los datos con atención:\n\n' +
        'Cuenta de Ahorros Bancolombia No. 123123-5235-23535/ Alejandro Martinez\n\n' +
        'Una vez realizado, debes enviar tu comprobante de forma clara y legible para que podamos dar procedencia a tu pago, proceso que puede tardar hasta 24 horas. Gracias!',
    );
  });
});
