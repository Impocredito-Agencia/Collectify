import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DeleteLoanDto } from './deleteLoan.dto';

describe('DeleteLoanDto', () => {
  it('accepts a reason and a typed number', async () => {
    const errors = await validate(
      plainToInstance(DeleteLoanDto, {
        reason: 'Pagaré de prueba',
        confirmPromissoryNoteNumber: '#9999',
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('trims the reason and rejects one that is only spaces', async () => {
    const dto = plainToInstance(DeleteLoanDto, {
      reason: '   ',
      confirmPromissoryNoteNumber: '#9999',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('reason');
  });

  it('rejects a missing typed number', async () => {
    const errors = await validate(
      plainToInstance(DeleteLoanDto, { reason: 'Pagaré de prueba' }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('confirmPromissoryNoteNumber');
  });
});
