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

  // Bug fix, 2026-09-08 — an overdue installment's totalDue already nets
  // out payments AND folds in accrued mora; using it directly (instead of
  // re-deriving `amount - paid`, which ignores mora entirely) is what makes
  // this note match the client's real remaining balance.
  describe('totalDue-aware gap (overdue installments)', () => {
    it('uses totalDue instead of amount - paid when provided, including accrued mora', () => {
      expect(
        computeSaldoPendiente(
          // amount - paid would say 100000 (300000 - 200000); totalDue
          // (already net of the same payment) says the real figure once
          // mora is folded in.
          [{ id: 'i1', amount: 300000, totalDue: 106000 }],
          [{ installmentId: 'i1', amountPaid: 200000 }],
        ),
      ).toBe(106000);
    });

    it('still requires a nonzero payment even when totalDue is provided — an untouched overdue installment is not "abono incompleto"', () => {
      expect(
        computeSaldoPendiente(
          [{ id: 'i1', amount: 300000, totalDue: 306000 }],
          [],
        ),
      ).toBe(0);
    });

    it('falls back to amount - paid for an installment with no totalDue (upcoming, not yet due)', () => {
      expect(
        computeSaldoPendiente(
          [{ id: 'i1', amount: 300000 }],
          [{ installmentId: 'i1', amountPaid: 100000 }],
        ),
      ).toBe(200000);
    });

    it('mixes totalDue-aware and amount-based gaps across overdue and upcoming installments in the same call', () => {
      expect(
        computeSaldoPendiente(
          [
            { id: 'overdue-1', amount: 300000, totalDue: 106000 },
            { id: 'upcoming-1', amount: 200000 },
          ],
          [
            { installmentId: 'overdue-1', amountPaid: 200000 },
            { installmentId: 'upcoming-1', amountPaid: 50000 },
          ],
        ),
      ).toBe(106000 + 150000);
    });
  });
});
