import { Repository } from 'typeorm';

import { Payment } from '../entities/payment.entity';

import { sumPaymentsByInstallmentId } from './paymentTotals';

describe('sumPaymentsByInstallmentId', () => {
  let paymentsRepository: { find: jest.Mock };

  beforeEach(() => {
    paymentsRepository = { find: jest.fn() };
  });

  it('returns an empty map without querying when given no ids', async () => {
    const result = await sumPaymentsByInstallmentId(
      paymentsRepository as unknown as Repository<Payment>,
      [],
    );

    expect(result.size).toBe(0);
    expect(paymentsRepository.find).not.toHaveBeenCalled();
  });

  it('sums multiple payments against the same installment', async () => {
    paymentsRepository.find.mockResolvedValue([
      { installmentId: 'inst-1', amountPaid: 800000 },
      { installmentId: 'inst-1', amountPaid: 50000 },
    ]);

    const result = await sumPaymentsByInstallmentId(
      paymentsRepository as unknown as Repository<Payment>,
      ['inst-1'],
    );

    expect(result.get('inst-1')).toBe(850000);
  });

  it('keeps totals separate per installment', async () => {
    paymentsRepository.find.mockResolvedValue([
      { installmentId: 'inst-1', amountPaid: 100000 },
      { installmentId: 'inst-2', amountPaid: 200000 },
    ]);

    const result = await sumPaymentsByInstallmentId(
      paymentsRepository as unknown as Repository<Payment>,
      ['inst-1', 'inst-2'],
    );

    expect(result.get('inst-1')).toBe(100000);
    expect(result.get('inst-2')).toBe(200000);
  });

  it('omits an installment id with no payments from the map entirely', async () => {
    paymentsRepository.find.mockResolvedValue([]);

    const result = await sumPaymentsByInstallmentId(
      paymentsRepository as unknown as Repository<Payment>,
      ['inst-1'],
    );

    expect(result.has('inst-1')).toBe(false);
  });

  // Human request, 2026-09-25 — mora forgiven together with a payment
  // reduces what is still owed exactly like cash does, so it counts here.
  // (Cash-collected figures read amountPaid directly and never this helper.)
  it('counts mora forgiven with a payment as covered, alongside the cash paid', async () => {
    paymentsRepository.find.mockResolvedValue([
      { installmentId: 'inst-1', amountPaid: 100000 },
      { installmentId: 'inst-1', amountPaid: 480000, moraWaivedAmount: 12000 },
    ]);

    const result = await sumPaymentsByInstallmentId(
      paymentsRepository as unknown as Repository<Payment>,
      ['inst-1'],
    );

    expect(result.get('inst-1')).toBe(592000);
  });
});
