import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RenumberLoanDto } from './renumberLoan.dto';

describe('RenumberLoanDto', () => {
  it.each(['#0001', '#1191', '#12345'])('accepts %s', async (number) => {
    const errors = await validate(
      plainToInstance(RenumberLoanDto, { promissoryNoteNumber: number }),
    );
    expect(errors).toHaveLength(0);
  });

  it.each(['1191', '#123', '#12a4', '', ' #1191'])(
    'rejects %p',
    async (number) => {
      const errors = await validate(
        plainToInstance(RenumberLoanDto, { promissoryNoteNumber: number }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('promissoryNoteNumber');
    },
  );

  it('rejects a missing number', async () => {
    const errors = await validate(plainToInstance(RenumberLoanDto, {}));
    expect(errors).toHaveLength(1);
  });
});
