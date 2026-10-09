import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BankAccountService } from './bankAccount.service';
import { AppSetting, AppSettingKey } from './entities/appSetting.entity';

describe('BankAccountService', () => {
  let service: BankAccountService;
  let repository: { findOneBy: jest.Mock; upsert: jest.Mock };

  const updatedAt = new Date('2026-10-09T15:00:00Z');
  const storedSetting = (value: string) => ({
    id: 'setting-1',
    key: AppSettingKey.PaymentBankAccount,
    value,
    createdAt: updatedAt,
    updatedAt,
  });

  beforeEach(async () => {
    repository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankAccountService,
        { provide: getRepositoryToken(AppSetting), useValue: repository },
      ],
    }).compile();

    service = module.get(BankAccountService);
  });

  describe('get', () => {
    it('returns nulls when no bank account has been entered yet', async () => {
      const result = await service.get();

      expect(repository.findOneBy).toHaveBeenCalledWith({
        key: AppSettingKey.PaymentBankAccount,
      });
      expect(result).toEqual({
        bankAccount: null,
        messagePreview: null,
        updatedAt: null,
      });
    });

    it('returns the stored account with the message a client would receive', async () => {
      repository.findOneBy.mockResolvedValue(storedSetting('Nequi 3001234567'));

      const result = await service.get();

      expect(result.bankAccount).toBe('Nequi 3001234567');
      expect(result.updatedAt).toBe(updatedAt);
      expect(result.messagePreview).toContain('\n\nNequi 3001234567\n\n');
      expect(result.messagePreview).toMatch(/^Podrás enviar el dinero/);
    });
  });

  describe('update', () => {
    it('stores the account flattened to a single line and returns it', async () => {
      repository.findOneBy.mockResolvedValue(
        storedSetting('Bancolombia No. 123 / Alejandro Martinez'),
      );

      const result = await service.update(
        '  Bancolombia No. 123\n/   Alejandro Martinez ',
      );

      expect(repository.upsert).toHaveBeenCalledWith(
        {
          key: AppSettingKey.PaymentBankAccount,
          value: 'Bancolombia No. 123 / Alejandro Martinez',
        },
        ['key'],
      );
      expect(result.bankAccount).toBe(
        'Bancolombia No. 123 / Alejandro Martinez',
      );
    });

    it('rejects a blank account without storing anything', async () => {
      await expect(service.update(' \n ')).rejects.toThrow(BadRequestException);
      expect(repository.upsert).not.toHaveBeenCalled();
    });
  });
});
