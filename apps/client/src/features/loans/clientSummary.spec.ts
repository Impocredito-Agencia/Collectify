import { describe, expect, it } from 'vitest';

import { InstallmentStatus } from '@/features/installments/installmentsApi';

import { buildClientSummary } from './clientSummary';

import type { Installment } from '@/features/installments/installmentsApi';

function installment(overrides: Partial<Installment>): Installment {
  return {
    id: 'inst',
    loanId: 'loan-1',
    installmentNumber: 1,
    amount: 210000,
    principalPortion: 195349,
    dueDate: '2024-03-30',
    status: InstallmentStatus.Pending,
    isDownPayment: false,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    overdueDays: 0,
    interest: 0,
    totalDue: 210000,
    conceptBreakdown: [],
    ...overrides,
  };
}

// The pagaré from the client's own screenshot (2026-10-23): cuotas 1-2 paid,
// 3-4 overdue with their mora surcharges.
const screenshotLoan = [
  installment({
    id: 'i1',
    installmentNumber: 1,
    status: InstallmentStatus.Paid,
  }),
  installment({
    id: 'i2',
    installmentNumber: 2,
    status: InstallmentStatus.Paid,
  }),
  installment({
    id: 'i3',
    installmentNumber: 3,
    dueDate: '2024-05-30',
    overdueDays: 876,
    interest: 429240,
    totalDue: 639200,
  }),
  installment({
    id: 'i4',
    installmentNumber: 4,
    dueDate: '2024-06-30',
    overdueDays: 845,
    interest: 414050,
    totalDue: 624100,
  }),
];

describe('buildClientSummary', () => {
  // 210.000 + 429.240 = 639.240, but the api rounds the cuota's total to
  // 639.200 — the surcharge shown is the rounded one, so the row adds up.
  it('lists pending cuotas with their rounded mora surcharges as one figure', () => {
    const summary = buildClientSummary(screenshotLoan);

    expect(summary.rows[2]).toEqual(
      expect.objectContaining({
        overdueDays: 876,
        amount: 210000,
        surcharges: 429200,
        paidSoFar: 0,
        totalDue: 639200,
      }),
    );
  });

  // Client request, 2026-10-26 — the debtor sees their whole plan.
  it('lists paid cuotas too, in plan order, owing nothing', () => {
    const summary = buildClientSummary([...screenshotLoan].reverse());

    expect(summary.rows.map((row) => row.installmentNumber)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(summary.rows[0]).toEqual(
      expect.objectContaining({
        isPaid: true,
        overdueDays: 0,
        amount: 210000,
        surcharges: 0,
        paidSoFar: 0,
        totalDue: 0,
      }),
    );
    expect(summary.rows[2].isPaid).toBe(false);
    expect(summary.hasPartialPayments).toBe(false);
  });

  it('counts paid cuotas and totals only what is overdue', () => {
    const summary = buildClientSummary([
      ...screenshotLoan,
      installment({
        id: 'i5',
        installmentNumber: 5,
        dueDate: '2099-07-30',
      }),
    ]);

    expect(summary.paidCount).toBe(2);
    expect(summary.totalCount).toBe(5);
    expect(summary.overdueCount).toBe(2);
    expect(summary.overdueTotal).toBe(639200 + 624100);
  });

  it('derives a partial payment from totalDue and flags it', () => {
    const summary = buildClientSummary([
      installment({
        overdueDays: 10,
        interest: 5000,
        totalDue: 115000, // 210.000 + 5.000 − 100.000 abonados
      }),
    ]);

    expect(summary.rows[0].paidSoFar).toBe(100000);
    expect(summary.hasPartialPayments).toBe(true);
  });

  it('leaves cancelled cuotas out of every count', () => {
    const summary = buildClientSummary([
      installment({ id: 'a', status: InstallmentStatus.Paid }),
      installment({ id: 'b', status: InstallmentStatus.Cancelled }),
    ]);

    expect(summary.rows.map((row) => row.installmentId)).toEqual(['a']);
    expect(summary.totalCount).toBe(1);
    expect(summary.hasPartialPayments).toBe(false);
  });
});
