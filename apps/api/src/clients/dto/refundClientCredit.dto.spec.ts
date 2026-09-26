import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RefundClientCreditDto } from './refundClientCredit.dto';

describe('RefundClientCreditDto', () => {
  it('accepts a positive amount with an optional reason', async () => {
    const errors = await validate(
      plainToInstance(RefundClientCreditDto, {
        amount: 50000,
        reason: 'Pidió el excedente',
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts an amount without a reason', async () => {
    const errors = await validate(
      plainToInstance(RefundClientCreditDto, { amount: 50000 }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing, zero or negative amount', async () => {
    for (const body of [{}, { amount: 0 }, { amount: -10 }]) {
      const errors = await validate(
        plainToInstance(RefundClientCreditDto, body),
      );
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects a reason over 500 characters', async () => {
    const errors = await validate(
      plainToInstance(RefundClientCreditDto, {
        amount: 1000,
        reason: 'x'.repeat(501),
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('reason');
  });
});
