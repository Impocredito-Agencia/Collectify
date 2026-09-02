import { computeSaldoPendiente } from './saldoPendiente';

describe('computeSaldoPendiente', () => {
  it('returns 0 when there are no payments at all', () => {
    expect(computeSaldoPendiente([{ id: 'i1', amount: 300000 }], [])).toBe(0);
  });

  it('returns 0 when a payment fully covers its installment', () => {
    expect(
      computeSaldoPendiente(
        [{ id: 'i1', amount: 300000 }],
        [{ installmentId: 'i1', amountPaid: 300000 }],
      ),
    ).toBe(0);
  });

  it('returns the gap for a single partially-paid installment', () => {
    expect(
      computeSaldoPendiente(
        [{ id: 'i1', amount: 300000 }],
        [{ installmentId: 'i1', amountPaid: 100000 }],
      ),
    ).toBe(200000);
  });

  it('sums payments made across more than one row against the same installment', () => {
    expect(
      computeSaldoPendiente(
        [{ id: 'i1', amount: 300000 }],
        [
          { installmentId: 'i1', amountPaid: 100000 },
          { installmentId: 'i1', amountPaid: 50000 },
        ],
      ),
    ).toBe(150000);
  });

  it('sums gaps across multiple installments, ignoring unpaid ones', () => {
    expect(
      computeSaldoPendiente(
        [
          { id: 'i1', amount: 300000 },
          { id: 'i2', amount: 200000 },
        ],
        [{ installmentId: 'i1', amountPaid: 100000 }],
      ),
    ).toBe(200000);
  });

  it('never returns a negative amount when overpaid (that becomes saldo a favor, not this)', () => {
    expect(
      computeSaldoPendiente(
        [{ id: 'i1', amount: 300000 }],
        [{ installmentId: 'i1', amountPaid: 400000 }],
      ),
    ).toBe(0);
  });
});
