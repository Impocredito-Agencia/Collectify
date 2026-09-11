import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreatePaymentDto } from './createPayment.dto';

// TESTING.md doesn't require DTO unit tests in general ("no logic to
// test"), but docs/phases/PHASE_12_PAYMENT_ATTACHMENTS.md explicitly lists
// "invalid imageUrl is rejected by DTO validation" as mandatory test scope
// for this phase — @IsUrl is the only actual validation logic imageUrls
// carries, so it's tested directly here rather than only indirectly
// through a service/controller test. Phase 28 widened the field from a
// single imageUrl to imageUrls: string[].
describe('CreatePaymentDto', () => {
  const baseInput = { amountPaid: 150000, paidAt: '2026-07-09' };

  it('is valid without imageUrls', async () => {
    const dto = plainToInstance(CreatePaymentDto, baseInput);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('is valid with one or more well-formed imageUrls', async () => {
    const dto = plainToInstance(CreatePaymentDto, {
      ...baseInput,
      imageUrls: [
        'https://res.cloudinary.com/demo/image/upload/receipt-1.jpg',
        'https://res.cloudinary.com/demo/image/upload/receipt-2.jpg',
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed URL anywhere in imageUrls', async () => {
    const dto = plainToInstance(CreatePaymentDto, {
      ...baseInput,
      imageUrls: [
        'https://res.cloudinary.com/demo/image/upload/receipt.jpg',
        'not-a-url',
      ],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('imageUrls');
    expect(errors[0].constraints).toHaveProperty('isUrl');
  });

  // Human report, 2026-09-11 — the "Registrar pago con este comprobante"
  // flow's own validation logic (@IsUUID), same reasoning as imageUrls
  // above for testing it directly here.
  it('is valid with a well-formed sourceWhatsappMessageId', async () => {
    const dto = plainToInstance(CreatePaymentDto, {
      ...baseInput,
      sourceWhatsappMessageId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed sourceWhatsappMessageId', async () => {
    const dto = plainToInstance(CreatePaymentDto, {
      ...baseInput,
      sourceWhatsappMessageId: 'not-a-uuid',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('sourceWhatsappMessageId');
    expect(errors[0].constraints).toHaveProperty('isUuid');
  });
});
