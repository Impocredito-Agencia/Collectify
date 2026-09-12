import { Client } from '../clients/entities/client.entity';

import {
  OverdueInstallmentResult,
  UpcomingInstallmentResult,
} from './reminderInstallmentQueries';
import {
  groupInstallmentsByRecipient,
  restrictToTargetPhoneNumber,
} from './reminderRecipientGrouping';

describe('groupInstallmentsByRecipient', () => {
  const client = {
    id: 'client-1',
    phoneNumber: '+573001234567',
    alternatePhoneNumber: null,
  } as Client;

  function overdue(
    overrides: Partial<OverdueInstallmentResult> = {},
  ): OverdueInstallmentResult {
    return {
      id: 'inst-1',
      loanId: 'loan-1',
      alternateContactPhoneNumber: null,
      installmentNumber: 1,
      promissoryNoteNumber: '#743',
      amount: 200000,
      totalDue: 200000,
      overdueDays: 5,
      interest: 0,
      ...overrides,
    };
  }

  function upcoming(
    overrides: Partial<UpcomingInstallmentResult> = {},
  ): UpcomingInstallmentResult {
    return {
      id: 'inst-2',
      loanId: 'loan-1',
      alternateContactPhoneNumber: null,
      installmentNumber: 2,
      promissoryNoteNumber: '#743',
      amount: 200000,
      daysUntilDue: 3,
      ...overrides,
    };
  }

  it('returns a single client group when no loan has an alternate contact', () => {
    const groups = groupInstallmentsByRecipient(
      [overdue()],
      [upcoming()],
      client,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].recipientPhoneNumbers).toEqual(['+573001234567']);
    expect(groups[0].overdue).toHaveLength(1);
    expect(groups[0].upcoming).toHaveLength(1);
  });

  // Human report, 2026-09-19 — the exact scenario confirmed with the
  // human: a client with several loans, only one carrying the alternate
  // contact override, must get two SEPARATE messages — their own
  // (covering only their normal loans) and the contact's (covering only
  // the override loan), never one merged message and never the override
  // loan silently missing from both.
  it('splits into a client group and a contact group when one loan has an alternate contact', () => {
    const groups = groupInstallmentsByRecipient(
      [
        overdue({ id: 'inst-normal', loanId: 'loan-normal' }),
        overdue({
          id: 'inst-contact',
          loanId: 'loan-contact',
          alternateContactPhoneNumber: '+573009876543',
        }),
      ],
      [],
      client,
    );

    expect(groups).toHaveLength(2);
    const clientGroup = groups.find((g) =>
      g.recipientPhoneNumbers.includes('+573001234567'),
    );
    const contactGroup = groups.find((g) =>
      g.recipientPhoneNumbers.includes('+573009876543'),
    );
    expect(clientGroup?.overdue.map((i) => i.id)).toEqual(['inst-normal']);
    expect(contactGroup?.recipientPhoneNumbers).toEqual(['+573009876543']);
    expect(contactGroup?.overdue.map((i) => i.id)).toEqual(['inst-contact']);
  });

  it('omits the client group entirely when every installment belongs to a contact-routed loan', () => {
    const groups = groupInstallmentsByRecipient(
      [
        overdue({
          alternateContactPhoneNumber: '+573009876543',
        }),
      ],
      [],
      client,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].recipientPhoneNumbers).toEqual(['+573009876543']);
  });

  it('groups two different contacts on two different loans separately', () => {
    const groups = groupInstallmentsByRecipient(
      [
        overdue({
          id: 'inst-a',
          loanId: 'loan-a',
          alternateContactPhoneNumber: '+573001111111',
        }),
        overdue({
          id: 'inst-b',
          loanId: 'loan-b',
          alternateContactPhoneNumber: '+573002222222',
        }),
      ],
      [],
      client,
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.recipientPhoneNumbers[0]).sort()).toEqual([
      '+573001111111',
      '+573002222222',
    ]);
  });
});

describe('restrictToTargetPhoneNumber', () => {
  it('keeps only the group containing the target number, narrowed to just that number', () => {
    const groups = [
      {
        recipientPhoneNumbers: ['+573001234567', '+573009999999'],
        overdue: [],
        upcoming: [],
      },
      { recipientPhoneNumbers: ['+573005555555'], overdue: [], upcoming: [] },
    ];

    const result = restrictToTargetPhoneNumber(groups, '+573001234567');

    expect(result).toHaveLength(1);
    expect(result[0].recipientPhoneNumbers).toEqual(['+573001234567']);
  });

  it('returns an empty array when no group matches the target number', () => {
    const groups = [
      { recipientPhoneNumbers: ['+573001234567'], overdue: [], upcoming: [] },
    ];

    expect(restrictToTargetPhoneNumber(groups, '+573000000000')).toEqual([]);
  });
});
