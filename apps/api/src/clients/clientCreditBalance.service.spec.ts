import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';

import { Client } from './entities/client.entity';

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
  let clientsRepository: { findOne: jest.Mock };

  beforeEach(async () => {
    ledgerRepository = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    installmentsRepository = { findOneBy: jest.fn() };
    loansRepository = { findOneBy: jest.fn() };
    clientsRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'client-1' }),
    };
    // A transaction is just "run the callback with a manager" here; the
    // manager hands out the same ledger/client mocks as everywhere else.
    const manager = {
      getRepository: (entity: unknown) =>
        entity === Client ? clientsRepository : ledgerRepository,
    };
    const dataSource = {
      transaction: jest.fn((callback: (m: unknown) => unknown) =>
        callback(manager),
      ),
    };

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
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<ClientCreditBalanceService>(
      ClientCreditBalanceService,
    );
  });

  // Human request, 2026-09-26 — refunds, reversals and restorations.
  describe('balance with the newer movements', () => {
    it('adds Created and Restored, subtracts Applied, Refunded and Reversed', async () => {
      ledgerRepository.find.mockResolvedValue([
        { type: ClientCreditLedgerEntryType.Created, amount: 100000 },
        { type: ClientCreditLedgerEntryType.Applied, amount: 30000 },
        { type: ClientCreditLedgerEntryType.Restored, amount: 10000 },
        { type: ClientCreditLedgerEntryType.Refunded, amount: 20000 },
        { type: ClientCreditLedgerEntryType.Reversed, amount: 5000 },
      ]);

      // 100000 − 30000 + 10000 − 20000 − 5000
      expect(await service.getBalance('client-1')).toBe(55000);
    });
  });

  describe('refund', () => {
    beforeEach(() => {
      ledgerRepository.find.mockResolvedValue([
        { type: ClientCreditLedgerEntryType.Created, amount: 80000 },
      ]);
    });

    it('records a Refunded entry with the reason and returns the new balance', async () => {
      const result = await service.refund(
        'client-1',
        30000,
        '  Pidió el excedente  ',
      );

      expect(ledgerRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          type: ClientCreditLedgerEntryType.Refunded,
          amount: 30000,
          note: 'Pidió el excedente',
        }),
      );
      expect(result).toEqual({ balance: 50000 });
    });

    it('can return the whole balance', async () => {
      const result = await service.refund('client-1', 80000);

      expect(result).toEqual({ balance: 0 });
      expect(ledgerRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 80000, note: null }),
      );
    });

    it('locks the client row so two refunds cannot both spend the same balance', async () => {
      await service.refund('client-1', 1000);

      expect(clientsRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-1' },
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('rejects more than the available balance, and records nothing', async () => {
      await expect(service.refund('client-1', 80001)).rejects.toThrow(
        BadRequestException,
      );
      expect(ledgerRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a non-positive amount', async () => {
      await expect(service.refund('client-1', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.refund('client-1', -5)).rejects.toThrow(
        BadRequestException,
      );
      expect(ledgerRepository.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown client', async () => {
      clientsRepository.findOne.mockResolvedValue(null);

      await expect(service.refund('nope', 1000)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reverseCreditGeneratedBy', () => {
    const manager = {
      getRepository: (entity: unknown) =>
        entity === Client ? clientsRepository : ledgerRepository,
    };

    // find() is called for the payment's own entries first, then for the
    // client's whole ledger (the balance).
    function mockLedger(forPayment: unknown[], wholeLedger: unknown[]): void {
      ledgerRepository.find.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(where.sourcePaymentId ? forPayment : wholeLedger),
      );
    }

    it('takes back the credit the voided payment generated when the client still has it', async () => {
      mockLedger(
        [
          {
            clientId: 'client-1',
            type: ClientCreditLedgerEntryType.Created,
            amount: 40000,
          },
        ],
        [{ type: ClientCreditLedgerEntryType.Created, amount: 40000 }],
      );

      await service.reverseCreditGeneratedBy('payment-1', manager as never);

      expect(ledgerRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          type: ClientCreditLedgerEntryType.Reversed,
          amount: 40000,
          sourcePaymentId: 'payment-1',
        }),
      );
    });

    it('refuses when part of that credit was already applied to other cuotas', async () => {
      mockLedger(
        [
          {
            clientId: 'client-1',
            type: ClientCreditLedgerEntryType.Created,
            amount: 40000,
          },
        ],
        [
          { type: ClientCreditLedgerEntryType.Created, amount: 40000 },
          { type: ClientCreditLedgerEntryType.Applied, amount: 25000 },
        ],
      );

      await expect(
        service.reverseCreditGeneratedBy('payment-1', manager as never),
      ).rejects.toThrow(/solo le quedan \$15000/);
      expect(ledgerRepository.save).not.toHaveBeenCalled();
    });

    it('refuses when the credit was already refunded to the client', async () => {
      mockLedger(
        [
          {
            clientId: 'client-1',
            type: ClientCreditLedgerEntryType.Created,
            amount: 40000,
          },
        ],
        [
          { type: ClientCreditLedgerEntryType.Created, amount: 40000 },
          { type: ClientCreditLedgerEntryType.Refunded, amount: 40000 },
        ],
      );

      await expect(
        service.reverseCreditGeneratedBy('payment-1', manager as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('does nothing for a payment that generated no credit', async () => {
      mockLedger([], []);

      await service.reverseCreditGeneratedBy('payment-1', manager as never);

      expect(ledgerRepository.save).not.toHaveBeenCalled();
    });

    it('does not reverse the same credit twice', async () => {
      mockLedger(
        [
          {
            clientId: 'client-1',
            type: ClientCreditLedgerEntryType.Created,
            amount: 40000,
          },
          {
            clientId: 'client-1',
            type: ClientCreditLedgerEntryType.Reversed,
            amount: 40000,
          },
        ],
        [],
      );

      await service.reverseCreditGeneratedBy('payment-1', manager as never);

      expect(ledgerRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('restoreCreditSpentBy', () => {
    const manager = {
      getRepository: () => ledgerRepository,
    };

    it('gives back the credit a voided credit-funded payment had spent', async () => {
      ledgerRepository.find.mockResolvedValue([
        {
          clientId: 'client-1',
          type: ClientCreditLedgerEntryType.Applied,
          amount: 30000,
        },
      ]);

      await service.restoreCreditSpentBy('payment-1', manager as never);

      expect(ledgerRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          type: ClientCreditLedgerEntryType.Restored,
          amount: 30000,
          resultingPaymentId: 'payment-1',
        }),
      );
    });

    it('does nothing for a payment that was not funded by credit, or was already restored', async () => {
      ledgerRepository.find.mockResolvedValue([]);
      await service.restoreCreditSpentBy('payment-1', manager as never);

      ledgerRepository.find.mockResolvedValue([
        {
          clientId: 'client-1',
          type: ClientCreditLedgerEntryType.Applied,
          amount: 30000,
        },
        {
          clientId: 'client-1',
          type: ClientCreditLedgerEntryType.Restored,
          amount: 30000,
        },
      ]);
      await service.restoreCreditSpentBy('payment-1', manager as never);

      expect(ledgerRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('summarizeCreditByPaymentId', () => {
    it('reports, per payment, the credit it generated and the credit it spent, net of reversals/restorations', async () => {
      ledgerRepository.find.mockResolvedValue([
        {
          type: ClientCreditLedgerEntryType.Created,
          amount: 50000,
          sourcePaymentId: 'p1',
        },
        {
          type: ClientCreditLedgerEntryType.Reversed,
          amount: 20000,
          sourcePaymentId: 'p1',
        },
        {
          type: ClientCreditLedgerEntryType.Applied,
          amount: 30000,
          resultingPaymentId: 'p2',
        },
      ]);

      const summary = await service.summarizeCreditByPaymentId(['p1', 'p2']);

      expect(summary.get('p1')).toEqual({ generated: 30000, spent: 0 });
      expect(summary.get('p2')).toEqual({ generated: 0, spent: 30000 });
    });

    it('returns an empty map without querying when given no ids', async () => {
      const summary = await service.summarizeCreditByPaymentId([]);

      expect(summary.size).toBe(0);
      expect(ledgerRepository.find).not.toHaveBeenCalled();
    });
  });

  // Phase 35 — see LoanDeletionService's credit blocker.
  describe('findCreditDrawsOutside', () => {
    const at = (day: number) => new Date(`2026-11-0${day}T12:00:00Z`);

    it('lists still-standing applications to other payments and every refund', async () => {
      ledgerRepository.find.mockResolvedValue([
        {
          type: ClientCreditLedgerEntryType.Created,
          amount: 300000,
          sourcePaymentId: 'own',
          resultingPaymentId: null,
          createdAt: at(1),
        },
        {
          type: ClientCreditLedgerEntryType.Applied,
          amount: 100000,
          sourcePaymentId: null,
          resultingPaymentId: 'other',
          createdAt: at(2),
        },
        {
          type: ClientCreditLedgerEntryType.Refunded,
          amount: 50000,
          sourcePaymentId: null,
          resultingPaymentId: null,
          createdAt: at(3),
        },
      ]);

      const draws = await service.findCreditDrawsOutside('client-1', ['own']);

      expect(draws).toEqual([
        {
          type: 'applied',
          amount: 100000,
          resultingPaymentId: 'other',
          createdAt: at(2),
        },
        {
          type: 'refunded',
          amount: 50000,
          resultingPaymentId: null,
          createdAt: at(3),
        },
      ]);
    });

    it('leaves out applications to the given payments and ones already restored', async () => {
      ledgerRepository.find.mockResolvedValue([
        {
          type: ClientCreditLedgerEntryType.Applied,
          amount: 80000,
          sourcePaymentId: null,
          resultingPaymentId: 'own',
          createdAt: at(1),
        },
        {
          type: ClientCreditLedgerEntryType.Applied,
          amount: 40000,
          sourcePaymentId: null,
          resultingPaymentId: 'voided',
          createdAt: at(2),
        },
        {
          type: ClientCreditLedgerEntryType.Restored,
          amount: 40000,
          sourcePaymentId: null,
          resultingPaymentId: 'voided',
          createdAt: at(3),
        },
      ]);

      const draws = await service.findCreditDrawsOutside('client-1', ['own']);

      expect(draws).toEqual([]);
    });
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
