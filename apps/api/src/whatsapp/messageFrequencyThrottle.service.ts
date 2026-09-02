import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ClientMessageFrequency } from '../clients/entities/clientMessageFrequency.entity';

import { MessageLog } from './entities/messageLog.entity';
import { MessageType } from './messageType.enum';

// Phase 27 — replaces MessageAudiencesService for the overdue/upcoming_due
// crons. The curated-audience-as-required-filter design (Phase 18) is
// reversed: every dynamically-qualifying client is messaged by default
// again. This service only narrows that set further by THROTTLING a
// whitelisted client's frequency — it never adds eligibility the way the
// old audience never did either, and unlike the old audience, an empty or
// nonexistent whitelist blocks nobody (the opposite failure mode from
// Phase 18's "empty audience means nobody is reminded").
//
// Scope: only consumed by OverdueReminderService/UpcomingDueReminderService
// — account_summary and new_loan are confirmed out of scope, matching the
// client's own framing of the whitelist request. See
// docs/phases/PHASE_27_MESSAGE_FREQUENCY.md.
@Injectable()
export class MessageFrequencyThrottleService {
  constructor(
    @InjectRepository(ClientMessageFrequency)
    private readonly clientMessageFrequenciesRepository: Repository<ClientMessageFrequency>,
    @InjectRepository(MessageLog)
    private readonly messageLogsRepository: Repository<MessageLog>,
  ) {}

  // Given every client who dynamically qualifies for `type` this run,
  // returns the subset that should actually be messaged: a client with no
  // whitelist row is always included (never throttled); a whitelisted
  // client is included only if at least `minimumDaysBetweenMessages` have
  // passed since their most recent message_logs row of this type (sent OR
  // failed — a failed attempt still counts as "we last reached out to
  // them then", matching the literal "since their last message_logs row"
  // wording in the phase brief rather than requiring a successful send).
  //
  // A throttled skip is silent by design (confirmed with the human,
  // 2026-08-30): unlike Phase 18's audience-member-with-nothing-to-report
  // rule, no internal record is kept of a client being evaluated and
  // skipped for being inside their throttle window.
  // Added Phase 33: `types` (plural) rather than a single MessageType —
  // "vencida" and "próxima a vencer" each now span several exact template
  // types (see reminderFamily.ts), but the throttle window is still one
  // per FAMILY, matching how the cron jobs themselves are grouped. Pass
  // every MessageType in the family; "last sent" is the most recent
  // message_logs row whose type is any of them.
  async filterOutThrottledClients(
    clientIds: string[],
    types: MessageType[],
  ): Promise<string[]> {
    if (clientIds.length === 0) {
      return clientIds;
    }

    const frequencies = await this.clientMessageFrequenciesRepository.findBy({
      clientId: In(clientIds),
    });
    if (frequencies.length === 0) {
      return clientIds;
    }

    const minDaysByClientId = new Map(
      frequencies.map((frequency) => [
        frequency.clientId,
        frequency.minimumDaysBetweenMessages,
      ]),
    );
    const lastSentAtByClientId = await this.getLastMessageDates(
      [...minDaysByClientId.keys()],
      types,
    );

    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    return clientIds.filter((clientId) => {
      const minDays = minDaysByClientId.get(clientId);
      if (minDays === undefined) {
        return true;
      }
      const lastSentAt = lastSentAtByClientId.get(clientId);
      if (!lastSentAt) {
        return true;
      }
      const daysSinceLastMessage = (now - lastSentAt.getTime()) / msPerDay;
      return daysSinceLastMessage >= minDays;
    });
  }

  private async getLastMessageDates(
    clientIds: string[],
    types: MessageType[],
  ): Promise<Map<string, Date>> {
    if (clientIds.length === 0) {
      return new Map();
    }

    const rows = await this.messageLogsRepository
      .createQueryBuilder('log')
      .select('log.client_id', 'clientId')
      .addSelect('MAX(log.sent_at)', 'lastSentAt')
      .where('log.client_id IN (:...clientIds)', { clientIds })
      .andWhere('log.type IN (:...types)', { types })
      .groupBy('log.client_id')
      .getRawMany<{ clientId: string; lastSentAt: Date }>();

    return new Map(rows.map((row) => [row.clientId, new Date(row.lastSentAt)]));
  }
}
