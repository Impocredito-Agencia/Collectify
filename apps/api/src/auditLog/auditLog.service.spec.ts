import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  bogotaEndOfDayUtc,
  bogotaStartOfDayUtc,
} from '../loans/dueDateSchedule';

import { AuditLog } from './entities/auditLog.entity';
import { AuditLogService } from './auditLog.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let repository: {
    findAndCount: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
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
    repository = {
      findAndCount: jest.fn(),
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
    it('returns a paginated page and applies the actorUserId/action/entityType/date filters', async () => {
      repository.findAndCount.mockResolvedValue([[mockEntry], 1]);

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
      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            actorUserId: 'user-1',
            action: 'client.create',
            entityType: 'client',
            // Bogotá-day bounds, not the naive UTC-midnight parse of the
            // raw string — see auditLog.service.ts's own comment on this
            // fix (2026-09-05).
            createdAt: expect.objectContaining({
              _type: 'between',
              _value: [
                bogotaStartOfDayUtc('2026-01-01'),
                bogotaEndOfDayUtc('2026-01-31'),
              ],
            }) as unknown,
          },
          order: { createdAt: 'DESC' },
          relations: { actorUser: true },
        }),
      );
    });

    it('applies an open-ended createdAt filter when only dateFrom is given', async () => {
      repository.findAndCount.mockResolvedValue([[mockEntry], 1]);

      await service.findAll({ dateFrom: '2026-01-01' });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              _type: 'moreThanOrEqual',
              _value: bogotaStartOfDayUtc('2026-01-01'),
            }) as unknown,
          }) as unknown,
        }),
      );
    });

    it('applies an open-ended createdAt filter when only dateTo is given', async () => {
      repository.findAndCount.mockResolvedValue([[mockEntry], 1]);

      await service.findAll({ dateTo: '2026-01-31' });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              _type: 'lessThanOrEqual',
              _value: bogotaEndOfDayUtc('2026-01-31'),
            }) as unknown,
          }) as unknown,
        }),
      );
    });

    it('returns an empty page when there are no matches', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll({});

      expect(result.items).toEqual([]);
      expect(result.meta.totalPages).toBe(0);
      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('respects custom page and limit', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ page: 2, limit: 5 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
    });

    it('combines filters correctly (actorUserId + entityType, no action)', async () => {
      repository.findAndCount.mockResolvedValue([[mockEntry], 1]);

      await service.findAll({ actorUserId: 'user-1', entityType: 'client' });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { actorUserId: 'user-1', entityType: 'client' },
        }),
      );
    });
  });
});
