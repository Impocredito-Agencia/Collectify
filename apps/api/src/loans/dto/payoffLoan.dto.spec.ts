import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PayoffLoanDto } from './payoffLoan.dto';

// Same @IsUrl-only validation CreatePaymentDto.imageUrls carries (see
// createPayment.dto.spec.ts), tested here because the payoff endpoint used to
// take no body at all — an empty body must keep working, and a malformed
// receipt URL must be rejected before any payment is registered.
describe('PayoffLoanDto', () => {
  it('is valid with an empty body (payoff without a receipt)', async () => {
    const errors = await validate(plainToInstance(PayoffLoanDto, {}));
    expect(errors).toHaveLength(0);
  });

  it('is valid with well-formed imageUrls', async () => {
    const errors = await validate(
      plainToInstance(PayoffLoanDto, {
        imageUrls: ['https://res.cloudinary.com/x/receipt-1.jpg'],
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects an imageUrl that is not a URL', async () => {
    const errors = await validate(
      plainToInstance(PayoffLoanDto, { imageUrls: ['not-a-url'] }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('imageUrls');
  });

  it('rejects imageUrls that is not an array', async () => {
    const errors = await validate(
      plainToInstance(PayoffLoanDto, {
        imageUrls: 'https://res.cloudinary.com/x/receipt-1.jpg',
      }),
    );
    expect(errors).toHaveLength(1);
  });
});
