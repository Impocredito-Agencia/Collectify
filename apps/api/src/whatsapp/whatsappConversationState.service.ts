import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  ConversationMenu,
  WhatsappConversationState,
} from './entities/whatsappConversationState.entity';

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

// Phase 34 — per-phone-number "where in the menu is this client right now"
// state. Ephemeral: an expired row is simply treated as "no state" by
// getActive() rather than cleaned up by a scheduled job — the simplest of
// the options docs/phases/PHASE_34_INTERACTIVE_MENU.md's open questions
// left on the table, revisit if row volume ever becomes a real concern.
@Injectable()
export class WhatsappConversationStateService {
  constructor(
    @InjectRepository(WhatsappConversationState)
    private readonly repository: Repository<WhatsappConversationState>,
  ) {}

  async getActive(
    phoneNumber: string,
  ): Promise<WhatsappConversationState | null> {
    const state = await this.repository.findOneBy({ phoneNumber });
    if (!state || state.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return state;
  }

  // Upserts by phoneNumber (unique) and always refreshes expiresAt to now +
  // 24h — matching the same session window Meta itself uses for this
  // client's messages.
  async upsert(
    phoneNumber: string,
    clientId: string | null,
    currentMenu: ConversationMenu,
  ): Promise<WhatsappConversationState> {
    const existing = await this.repository.findOneBy({ phoneNumber });
    const expiresAt = new Date(Date.now() + SESSION_WINDOW_MS);

    if (existing) {
      existing.clientId = clientId;
      existing.currentMenu = currentMenu;
      existing.expiresAt = expiresAt;
      return this.repository.save(existing);
    }

    return this.repository.save(
      this.repository.create({ phoneNumber, clientId, currentMenu, expiresAt }),
    );
  }

  // Ends conversation-state tracking for a number after a terminal action
  // (breakdown/history shown, receipt received, handoff acknowledged) — the
  // next unprompted message is treated as a fresh conversation, same as one
  // that arrives after natural expiry.
  async clear(phoneNumber: string): Promise<void> {
    await this.repository.delete({ phoneNumber });
  }
}
