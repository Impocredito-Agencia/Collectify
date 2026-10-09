import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  buildBankAccountTemplateMessage,
  normalizeBankAccount,
} from './bankAccountTemplate';
import { AppSetting, AppSettingKey } from './entities/appSetting.entity';

export interface BankAccountSetting {
  // Null until an admin enters one for the first time.
  bankAccount: string | null;
  // The exact text a client would receive right now — what the inbox's
  // "Enviar cuenta bancaria" dialog previews before sending.
  messagePreview: string | null;
  updatedAt: Date | null;
}

// Human request, 2026-10-09 — the bank account the cuenta_bancaria template
// sends is entered from the panel (the business changes accounts from time
// to time), not hardcoded. See bankAccountTemplate.ts.
@Injectable()
export class BankAccountService {
  constructor(
    @InjectRepository(AppSetting)
    private readonly appSettingsRepository: Repository<AppSetting>,
  ) {}

  async get(): Promise<BankAccountSetting> {
    const setting = await this.appSettingsRepository.findOneBy({
      key: AppSettingKey.PaymentBankAccount,
    });
    return this.toBankAccountSetting(setting);
  }

  async update(rawBankAccount: string): Promise<BankAccountSetting> {
    const bankAccount = normalizeBankAccount(rawBankAccount);
    if (!bankAccount) {
      throw new BadRequestException('La cuenta bancaria no puede estar vacía.');
    }

    await this.appSettingsRepository.upsert(
      { key: AppSettingKey.PaymentBankAccount, value: bankAccount },
      ['key'],
    );
    return this.get();
  }

  private toBankAccountSetting(setting: AppSetting | null): BankAccountSetting {
    if (!setting) {
      return { bankAccount: null, messagePreview: null, updatedAt: null };
    }
    return {
      bankAccount: setting.value,
      messagePreview: buildBankAccountTemplateMessage(setting.value)
        .messageContent,
      updatedAt: setting.updatedAt,
    };
  }
}
