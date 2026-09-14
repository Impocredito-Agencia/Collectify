import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';

import { ClientCreditBalanceService } from './clientCreditBalance.service';
import {
  ClientCreditLedgerEntry,
  ClientCreditLedgerEntryType,
} from './entities/clientCreditLedgerEntry.entity';

describe('ClientCreditBalanceService', () => {
  let service: ClientCreditBalanceService;
  let ledgerRepository: { create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let installmentsRepository: { findOneBy: jest.Mock };
  let loansRepository: { findOneBy: jest.Mock };

  beforeEach(async () => {
    ledgerRepository = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    installmentsRepository = { findOneBy: jest.fn() };
    loansRepository = { findOneBy: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientCreditBalanceService,
        {
          provide: getRepositoryToken(ClientCreditLedgerEntry),
          useValue: ledgerRepository,
        },
        {
          provide: getRepositoryToken(Installment),
          useValue: installmentsRepository,
        },
        { provide: getRepositoryToken(Loan), useValue: loansRepository },
      ],
    }).compile();

    service = module.get<ClientCreditBalanceService>(
      ClientCreditBalanceService,
    );
  });

  describe('getBalance', () => {
    it('returns 0 when the client has no ledger entries at all', async () => {
      ledgerRepository.find.mockResolvedValue([]);

      expect(await service.getBalance('client-1')).toBe(0);
    });

    it('sums Created entries and subtracts Applied entries', async () => {
      ledgerRepository.find.mockResolvedValue([
        { type: ClientCreditLedgerEntryType.Created, amount: 50000 },
        { type: ClientCreditLedgerEntryType.Created, amount: 20000 },
        { type: ClientCreditLedgerEntryType.Applied, amount: 30000 },
      ]);

      expect(await service.getBalance('client-1')).toBe(40000);
    });
  });

  describe('recordExcess', () => {
    it('saves a Created ledger entry for the given client/payment/amount', async () => {
      await service.recordExcess('client-1', 'payment-1', 50000);

      expect(ledgerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          type: ClientCreditLedgerEntryType.Created,
          amount: 50000,
          sourcePaymentId: 'payment-1',
        }),
      );
      expect(ledgerRepository.save).toHaveBeenCalled();
    });
  });

  describe('recordApplication', () => {
    it('saves an Applied ledger entry for the given client/payment/amount', async () => {
      await service.recordApplication('client-1', 'payment-2', 30000);

      expect(ledgerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          type: ClientCreditLedgerEntryType.Applied,
          amount: 30000,
          resultingPaymentId: 'payment-2',
        }),
      );
    });
  });

  describe('assertCanApply', () => {
    it('throws BadRequestException when the amount is not positive', async () => {
      await expect(
        service.assertCanApply('client-1', 'inst-1', 0),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the installment does not exist', async () => {
      installmentsRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.assertCanApply('client-1', 'inst-1', 10000),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when the installment doesn't belong to this client", async () => {
      installmentsRepository.findOneBy.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
      });
      loansRepository.findOneBy.mockResolvedValue({
        id: 'loan-1',
        clientId: 'client-2',
      });

      await expect(
        service.assertCanApply('client-1', 'inst-1', 10000),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the amount exceeds the available balance', async () => {
      installmentsRepository.findOneBy.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
      });
      loansRepository.findOneBy.mockResolvedValue({
        id: 'loan-1',
        clientId: 'client-1',
      });
      ledgerRepository.find.mockResolvedValue([
        { type: ClientCreditLedgerEntryType.Created, amount: 20000 },
      ]);

      await expect(
        service.assertCanApply('client-1', 'inst-1', 50000),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolves without throwing when the installment belongs to the client and the balance covers the amount', async () => {
      installmentsRepository.findOneBy.mockResolvedValue({
        id: 'inst-1',
        loanId: 'loan-1',
      });
      loansRepository.findOneBy.mockResolvedValue({
        id: 'loan-1',
        clientId: 'client-1',
      });
      ledgerRepository.find.mockResolvedValue([
        { type: ClientCreditLedgerEntryType.Created, amount: 50000 },
      ]);

      await expect(
        service.assertCanApply('client-1', 'inst-1', 50000),
      ).resolves.toBeUndefined();
    });
  });
});
