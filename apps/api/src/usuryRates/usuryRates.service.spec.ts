import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThanOrEqual } from 'typeorm';

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
      repository.findOne.mockResolvedValue(null);

      await expect(service.getCurrentRate()).resolves.toBeNull();
    });

    it('marks isStale false when the latest row matches the current month', async () => {
      repository.findOne.mockResolvedValue(
        makeRate({ effectiveMonth: '2026-09-01' }),
      );

      const result = await service.getCurrentRate(
        new Date('2026-09-15T12:00:00Z'),
      );

      expect(result?.isStale).toBe(false);
    });

    it('marks isStale true when the latest row is from a prior month', async () => {
      repository.findOne.mockResolvedValue(
        makeRate({ effectiveMonth: '2020-01-01' }),
      );

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
      repository.findOne.mockResolvedValue(
        makeRate({ effectiveMonth: '2026-09-01' }),
      );

      const result = await service.getCurrentRate(
        new Date('2026-10-01T02:00:00Z'),
      );

      expect(result?.isStale).toBe(false);
    });

    it('rolls over to the new month once it is genuinely October in Bogotá too', async () => {
      repository.findOne.mockResolvedValue(
        makeRate({ effectiveMonth: '2026-09-01' }),
      );

      // 2026-10-01T06:00Z is 2026-10-01 1am in Bogotá — genuinely October.
      const result = await service.getCurrentRate(
        new Date('2026-10-01T06:00:00Z'),
      );

      expect(result?.isStale).toBe(true);
    });

    it('bounds the query to the current month or earlier', async () => {
      repository.findOne.mockResolvedValue(makeRate());

      await service.getCurrentRate(new Date('2026-09-15T12:00:00Z'));

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { effectiveMonth: LessThanOrEqual('2026-09-01') },
        order: { effectiveMonth: 'DESC' },
      });
    });

    // Bug fix, 2026-09-30 (human report, production) — a row's own
    // effectiveMonth used to be irrelevant to whether it counted as
    // "current": the single most recent INSERT always won, future-dated
    // or not. Registering October's rate ahead of time, while still in
    // September, made October "vigente" immediately and flagged stale
    // against September's real calendar month — even though September's
    // own rate was already on file. The fix: a future-dated row is
    // invisible to getCurrentRate() until its own month actually arrives;
    // the real current month's row (if any) is used instead, found
    // through the same `LessThanOrEqual` getRateForMonth already trusts.
    it('ignores a rate entered in advance for a future month, using the real current month instead', async () => {
      // The real repository would also have October's row on file, but the
      // LessThanOrEqual bound asserted below excludes it — findOne is
      // mocked as TypeORM itself would behave given that filter, returning
      // September's row (the most recent one actually on or before today).
      repository.findOne.mockResolvedValue(
        makeRate({ effectiveMonth: '2026-09-01' }),
      );

      const result = await service.getCurrentRate(
        new Date('2026-09-30T23:00:00Z'), // 2026-09-30 6pm in Bogotá
      );

      expect(result?.effectiveMonth).toBe('2026-09-01');
      expect(result?.isStale).toBe(false);
      expect(repository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { effectiveMonth: LessThanOrEqual('2026-09-01') },
        }),
      );
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
