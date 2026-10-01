import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { UsuryRate } from './entities/usuryRate.entity';
import { UsuryRateService } from './usuryRates.service';

describe('UsuryRateService', () => {
  let service: UsuryRateService;
  let repository: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  function makeRate(overrides: Partial<UsuryRate> = {}): UsuryRate {
    return {
      id: 'rate-1',
      effectiveMonth: '2026-07-01',
      ratePercentage: 2.1,
      annualRatePercentage: 28,
      createdBy: 'user-1',
      createdByUser: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    repository = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto: Partial<UsuryRate>) => dto),
      save: jest.fn((rate: Partial<UsuryRate>) =>
        Promise.resolve({ id: 'rate-new', ...rate }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsuryRateService,
        { provide: getRepositoryToken(UsuryRate), useValue: repository },
      ],
    }).compile();

    service = module.get<UsuryRateService>(UsuryRateService);
  });

  describe('getCurrentRate', () => {
    it('returns null when no rate has ever been entered', async () => {
      repository.find.mockResolvedValue([]);

      await expect(service.getCurrentRate()).resolves.toBeNull();
    });

    it('marks isStale false when the latest row matches the current month', async () => {
      repository.find.mockResolvedValue([
        makeRate({ effectiveMonth: '2026-09-01' }),
      ]);

      const result = await service.getCurrentRate(
        new Date('2026-09-15T12:00:00Z'),
      );

      expect(result?.isStale).toBe(false);
    });

    it('marks isStale true when the latest row is from a prior month', async () => {
      repository.find.mockResolvedValue([
        makeRate({ effectiveMonth: '2020-01-01' }),
      ]);

      const result = await service.getCurrentRate();

      expect(result?.isStale).toBe(true);
    });

    // Bug fix, 2026-09-30 (human report) — comparing against the raw UTC
    // year-month made every evening in Bogotá (7pm onward, once UTC has
    // already rolled to the next calendar day) flag the just-entered
    // current month's rate as stale a few hours early. "2026-10-01T02:00Z"
    // is 2026-09-30 9pm in Bogotá (UTC-5) — still September there, even
    // though the UTC date is already October 1st.
    it('is not fooled by Bogotá still being in the current month after UTC has already rolled to the next one', async () => {
      repository.find.mockResolvedValue([
        makeRate({ effectiveMonth: '2026-09-01' }),
      ]);

      const result = await service.getCurrentRate(
        new Date('2026-10-01T02:00:00Z'),
      );

      expect(result?.isStale).toBe(false);
    });

    it('rolls over to the new month once it is genuinely October in Bogotá too', async () => {
      repository.find.mockResolvedValue([
        makeRate({ effectiveMonth: '2026-09-01' }),
      ]);

      // 2026-10-01T06:00Z is 2026-10-01 1am in Bogotá — genuinely October.
      const result = await service.getCurrentRate(
        new Date('2026-10-01T06:00:00Z'),
      );

      expect(result?.isStale).toBe(true);
    });

    it('queries only the single most recent row, not a where-filtered one', async () => {
      repository.find.mockResolvedValue([makeRate()]);

      await service.getCurrentRate();

      expect(repository.find).toHaveBeenCalledWith({
        order: { effectiveMonth: 'DESC' },
        take: 1,
      });
    });
  });

  describe('getRateForMonth', () => {
    it('queries for the most recent rate on or before the requested month', async () => {
      repository.findOne.mockResolvedValue(makeRate());

      await service.getRateForMonth('2026-07-15');

      expect(repository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ order: { effectiveMonth: 'DESC' } }),
      );
    });
  });

  describe('setRate', () => {
    it('creates a new row without altering any existing rate', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await service.setRate(
        { effectiveMonth: '2026-08-05', annualRatePercentage: 29.24 },
        'user-1',
      );

      // ratePercentage included since 2026-09-03's annual→monthly change
      // (see the "derives and stores..." test below) — this test's own
      // exact-match expectation was never updated to match, so it kept
      // asserting the pre-2026-09-03 shape and failed as soon as anything
      // exercised the real service instead of a hand-rolled stub.
      expect(repository.create).toHaveBeenCalledWith({
        effectiveMonth: '2026-08-01',
        annualRatePercentage: 29.24,
        ratePercentage: 2.1605,
        createdBy: 'user-1',
      });
      expect(repository.save).toHaveBeenCalled();
    });

    // Bug fix, 2026-09-03 — this used to be the value typed by hand
    // (ratePercentage). Now it must be derived from annualRatePercentage
    // via convertAnnualToMonthlyRate, not passed through as-is. Real
    // example the human provided: 29.24% annual → 2.1605% monthly.
    it('derives and stores the monthly effective rate from the annual rate', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await service.setRate(
        { effectiveMonth: '2026-08-05', annualRatePercentage: 29.24 },
        'user-1',
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ratePercentage: 2.1605 }),
      );
    });

    it('rejects a duplicate month instead of overwriting the existing rate', async () => {
      repository.findOneBy.mockResolvedValue(makeRate());

      await expect(
        service.setRate(
          { effectiveMonth: '2026-07-20', annualRatePercentage: 30 },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('orders history most recent month first', async () => {
      repository.find.mockResolvedValue([makeRate()]);

      await service.findAll();

      expect(repository.find).toHaveBeenCalledWith({
        order: { effectiveMonth: 'DESC' },
      });
    });
  });
});
