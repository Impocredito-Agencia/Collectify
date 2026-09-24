import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  bogotaEndOfDayUtc,
  bogotaStartOfDayUtc,
} from '../loans/dueDateSchedule';

import { AuditLog } from './entities/auditLog.entity';
import { AuditLogService, parseAuditSearchWords } from './auditLog.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let repository: {
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  // Chainable stand-in for TypeORM's QueryBuilder — every builder method
  // returns itself, so the tests can read back exactly which clauses/params
  // findAll() asked for. The real SQL (the search subqueries especially) is
  // checked against a live database, not here.
  let qb: {
    leftJoinAndSelect: jest.Mock;
    innerJoin: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    select: jest.Mock;
    addSelect: jest.Mock;
    distinct: jest.Mock;
    getManyAndCount: jest.Mock;
    getRawMany: jest.Mock;
  };

  const mockEntry: AuditLog = {
    id: 'log-1',
    actorUserId: 'user-1',
    actorUser: undefined as never,
    action: 'client.create',
    entityType: 'client',
    entityId: 'client-1',
    entityLabel: 'Juana Pérez (CC 123)',
    metadata: { params: {}, body: { firstName: 'Juana' } },
    createdAt: new Date(),
  };

  beforeEach(async () => {
    qb = {
      leftJoinAndSelect: jest.fn(),
      innerJoin: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      select: jest.fn(),
      addSelect: jest.fn(),
      distinct: jest.fn(),
      getManyAndCount: jest.fn(),
      getRawMany: jest.fn(),
    };
    for (const method of [
      'leftJoinAndSelect',
      'innerJoin',
      'andWhere',
      'orderBy',
      'skip',
      'take',
      'select',
      'addSelect',
      'distinct',
    ] as const) {
      qb[method].mockReturnValue(qb);
    }
    repository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      create: jest.fn((dto: Partial<AuditLog>) => dto),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: getRepositoryToken(AuditLog), useValue: repository },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  describe('record', () => {
    it('creates and saves a new entry', async () => {
      repository.save.mockResolvedValue(mockEntry);

      await service.record({
        actorUserId: 'user-1',
        action: 'client.create',
        entityType: 'client',
        entityId: 'client-1',
        entityLabel: 'Juana Pérez (CC 123)',
        metadata: { params: {}, body: { firstName: 'Juana' } },
      });

      expect(repository.create).toHaveBeenCalledWith({
        actorUserId: 'user-1',
        action: 'client.create',
        entityType: 'client',
        entityId: 'client-1',
        entityLabel: 'Juana Pérez (CC 123)',
        metadata: { params: {}, body: { firstName: 'Juana' } },
      });
      expect(repository.save).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    const wheres = (): [string, Record<string, unknown> | undefined][] =>
      qb.andWhere.mock.calls as [string, Record<string, unknown> | undefined][];

    it('returns a paginated page and applies the actorUserId/action/entityType/date filters', async () => {
      qb.getManyAndCount.mockResolvedValue([[mockEntry], 1]);

      const result = await service.findAll({
        actorUserId: 'user-1',
        action: 'client.create',
        entityType: 'client',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });

      expect(result).toEqual({
        items: [mockEntry],
        // limit 50 since 2026-09-05's default-page-size bump (style cleanup —
        // matches clients.service.ts's DEFAULT_PAGE_SIZE).
        meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
      });
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'log.actorUser',
        'actorUser',
      );
      expect(wheres()).toEqual([
        ['log.actorUserId = :actorUserId', { actorUserId: 'user-1' }],
        ['log.action = :action', { action: 'client.create' }],
        ['log.entityType = :entityType', { entityType: 'client' }],
        // Bogotá-day bounds, not the naive UTC-midnight parse of the raw
        // string — see auditLog.service.ts's own comment on this fix
        // (2026-09-05).
        [
          'log.createdAt >= :dateFrom',
          { dateFrom: bogotaStartOfDayUtc('2026-01-01') },
        ],
        [
          'log.createdAt <= :dateTo',
          { dateTo: bogotaEndOfDayUtc('2026-01-31') },
        ],
      ]);
      expect(qb.orderBy).toHaveBeenCalledWith('log.createdAt', 'DESC');
    });

    it('applies an open-ended createdAt filter when only dateFrom is given', async () => {
      qb.getManyAndCount.mockResolvedValue([[mockEntry], 1]);

      await service.findAll({ dateFrom: '2026-01-01' });

      expect(wheres()).toEqual([
        [
          'log.createdAt >= :dateFrom',
          { dateFrom: bogotaStartOfDayUtc('2026-01-01') },
        ],
      ]);
    });

    it('applies an open-ended createdAt filter when only dateTo is given', async () => {
      qb.getManyAndCount.mockResolvedValue([[mockEntry], 1]);

      await service.findAll({ dateTo: '2026-01-31' });

      expect(wheres()).toEqual([
        [
          'log.createdAt <= :dateTo',
          { dateTo: bogotaEndOfDayUtc('2026-01-31') },
        ],
      ]);
    });

    it('returns an empty page and adds no conditions when there are no filters', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll({});

      expect(result.items).toEqual([]);
      expect(result.meta.totalPages).toBe(0);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('respects custom page and limit', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ page: 2, limit: 5 });

      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
    });

    it('combines filters correctly (actorUserId + entityType, no action)', async () => {
      qb.getManyAndCount.mockResolvedValue([[mockEntry], 1]);

      await service.findAll({ actorUserId: 'user-1', entityType: 'client' });

      expect(wheres().map(([clause]) => clause)).toEqual([
        'log.actorUserId = :actorUserId',
        'log.entityType = :entityType',
      ]);
    });

    describe('search', () => {
      it('adds one clause per word, each ILIKE-matching the label OR the related record ids', async () => {
        qb.getManyAndCount.mockResolvedValue([[mockEntry], 1]);

        await service.findAll({ search: 'Juana 0928' });

        const calls = wheres();
        expect(calls).toHaveLength(2);
        expect(calls[0][1]).toEqual({ searchWord0: '%Juana%' });
        expect(calls[1][1]).toEqual({ searchWord1: '%0928%' });
        for (const [clause] of calls) {
          expect(clause).toContain('log.entityLabel ILIKE');
          // client -> loans -> installments -> payments, all reachable from
          // one word.
          expect(clause).toContain('FROM clients c');
          expect(clause).toContain('FROM loans l');
          expect(clause).toContain('FROM installments i');
          expect(clause).toContain('FROM payments p');
        }
      });

      it('is combined with the other filters, not replacing them', async () => {
        qb.getManyAndCount.mockResolvedValue([[], 0]);

        await service.findAll({ search: 'Juana', action: 'loan.refinance' });

        const clauses = wheres().map(([clause]) => clause);
        expect(clauses).toHaveLength(2);
        expect(clauses[0]).toBe('log.action = :action');
        expect(clauses[1]).toContain('log.entityLabel ILIKE');
      });

      it('adds nothing for a blank search', async () => {
        qb.getManyAndCount.mockResolvedValue([[], 0]);

        await service.findAll({ search: '   ' });

        expect(qb.andWhere).not.toHaveBeenCalled();
      });
    });
  });

  describe('parseAuditSearchWords', () => {
    it('splits on any whitespace and drops empty words', () => {
      expect(parseAuditSearchWords('  Juana   Pérez\t0928 ')).toEqual([
        'Juana',
        'Pérez',
        '0928',
      ]);
    });

    it('drops a leading # so "#0928" and "0928" search the same', () => {
      expect(parseAuditSearchWords('#0928')).toEqual(['0928']);
    });

    it('drops a word that was only a #', () => {
      expect(parseAuditSearchWords('# Juana')).toEqual(['Juana']);
    });

    it('caps how many words are used', () => {
      expect(parseAuditSearchWords('a b c d e f g')).toHaveLength(5);
    });

    it('returns no words for an empty or missing search', () => {
      expect(parseAuditSearchWords(undefined)).toEqual([]);
      expect(parseAuditSearchWords('')).toEqual([]);
    });
  });

  describe('search wildcard escaping', () => {
    it('matches % and _ literally instead of as ILIKE wildcards', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ search: '50%_x\\y' });

      const calls = qb.andWhere.mock.calls as [
        string,
        Record<string, string>,
      ][];
      expect(calls[0][1].searchWord0).toBe('%50\\%\\_x\\\\y%');
    });
  });

  describe('findActors', () => {
    it('returns each distinct user who appears in the trail, by name', async () => {
      qb.getRawMany.mockResolvedValue([{ id: 'user-1', fullName: 'Ana' }]);

      const result = await service.findActors();

      expect(result).toEqual([{ id: 'user-1', fullName: 'Ana' }]);
      expect(qb.innerJoin).toHaveBeenCalledWith('log.actorUser', 'actor');
      expect(qb.distinct).toHaveBeenCalledWith(true);
      expect(qb.orderBy).toHaveBeenCalledWith('actor.fullName', 'ASC');
    });
  });
});
