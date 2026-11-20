import { MessageType } from './messageType.enum';

export interface PlannedLogItem {
  installmentId: string;
  overdueDaysSnapshot: number;
  interestSnapshot: number;
}

// Phase 36, stage 3 — one reminder message, fully worked out but not sent
// yet: which template, with which values, to which phones, and what to log.
// The reminder services build these once; WhatsApp and the email/SMS
// sender (ChannelReminderService) both send from the same plan, so every
// channel carries exactly the same figures.
export interface PlannedReminder {
  type: MessageType;
  bodyParameters: string[];
  // Already excludes muted numbers (groupInstallmentsByRecipient).
  recipientPhoneNumbers: string[];
  // True for the client's own message; false for a loan whose reminders go
  // to its third-party contact instead (see groupInstallmentsByRecipient).
  // Email only exists for the client, so it's only ever sent for these.
  isClientGroup: boolean;
  breakdownContent: string | null;
  items: PlannedLogItem[];
}

interface OverdueForLog {
  id: string;
  overdueDays: number;
  interest: number;
  alternateContactPhoneNumber?: string | null;
}

interface UpcomingForLog {
  id: string;
  alternateContactPhoneNumber?: string | null;
}

export function buildPlannedLogItems(
  overdue: OverdueForLog[],
  upcoming: UpcomingForLog[],
): PlannedLogItem[] {
  return [
    ...overdue.map((installment) => ({
      installmentId: installment.id,
      overdueDaysSnapshot: installment.overdueDays,
      // Bug fix, 2026-09-07 — `interest`, not `totalDue - amount`: totalDue
      // nets out payments already made, so a partially paid installment
      // would snapshot an understated (even negative) interest.
      interestSnapshot: installment.interest,
    })),
    ...upcoming.map((installment) => ({
      installmentId: installment.id,
      overdueDaysSnapshot: 0,
      interestSnapshot: 0,
    })),
  ];
}

export function isClientGroup(
  overdue: UpcomingForLog[],
  upcoming: UpcomingForLog[],
): boolean {
  return ![...overdue, ...upcoming].some(
    (installment) => installment.alternateContactPhoneNumber,
  );
}
