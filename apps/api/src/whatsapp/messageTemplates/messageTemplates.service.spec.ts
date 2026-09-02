import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MessageTemplate } from '../entities/messageTemplate.entity';
import { MessageType } from '../messageType.enum';

import { MessageTemplatesService } from './messageTemplates.service';

describe('MessageTemplatesService', () => {
  let service: MessageTemplatesService;
  let repository: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
  };

  const mockTemplate: MessageTemplate = {
    id: 'template-1',
    name: 'Weekly reminder',
    type: MessageType.SingleOverdueInstallment,
    content: 'Hola {{clientFullName}}',
    metaTemplateName: 'una_cuota_vencida',
    metaLanguageCode: 'es',
    cronExpression: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    repository = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageTemplatesService,
        { provide: getRepositoryToken(MessageTemplate), useValue: repository },
      ],
    }).compile();

    service = module.get<MessageTemplatesService>(MessageTemplatesService);
  });

  describe('findAll', () => {
    it('returns every message template ordered by type', async () => {
      repository.find.mockResolvedValue([mockTemplate]);

      const result = await service.findAll();

      expect(result).toEqual([mockTemplate]);
      expect(repository.find).toHaveBeenCalledWith({ order: { type: 'ASC' } });
    });
  });

  describe('findByTypeOrThrow', () => {
    it('returns the template for the given type', async () => {
      repository.findOneBy.mockResolvedValue(mockTemplate);

      const result = await service.findByTypeOrThrow(
        MessageType.SingleOverdueInstallment,
      );

      expect(result).toEqual(mockTemplate);
      expect(repository.findOneBy).toHaveBeenCalledWith({
        type: MessageType.SingleOverdueInstallment,
      });
    });

    it('throws NotFoundException when no template of that type exists', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.findByTypeOrThrow(MessageType.NewLoanNewClient),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateCronExpression', () => {
    it('persists a valid cron expression on the template', async () => {
      repository.findOneBy.mockResolvedValue({ ...mockTemplate });
      repository.save.mockImplementation((template) =>
        Promise.resolve(template),
      );

      const result = await service.updateCronExpression(
        MessageType.SingleOverdueInstallment,
        '0 9 * * 1,3,5',
      );

      expect(result.cronExpression).toBe('0 9 * * 1,3,5');
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ cronExpression: '0 9 * * 1,3,5' }),
      );
    });

    it('throws BadRequestException for an invalid cron expression', async () => {
      await expect(
        service.updateCronExpression(
          MessageType.SingleOverdueInstallment,
          'not a cron',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(repository.findOneBy).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no template of that type exists', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateCronExpression(
          MessageType.SingleOverdueInstallment,
          '0 9 * * 1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
