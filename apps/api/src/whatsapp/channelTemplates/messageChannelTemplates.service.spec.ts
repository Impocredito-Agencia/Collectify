import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BrevoService } from '../../brevo/brevo.service';
import { BrevoChannel } from '../../brevo/brevoTypes';
import { CHANNEL_TEMPLATE_SEEDS } from '../../migrations/1792000000000-CreateMessageChannelTemplatesTable';
import { MessageChannelTemplate } from '../entities/messageChannelTemplate.entity';
import { MessageType } from '../messageType.enum';
import {
  exampleParametersFor,
  MESSAGE_TYPE_PARAMETERS,
} from '../messageTypeParameters';
import { countSmsSegments, toGsm7Text } from '../smsText';
import { renderTemplateBody } from '../templateBodyRenderer';

import { findInvalidPlaceholders } from './channelTemplateText';
import {
  MessageChannelTemplatesService,
  SMS_BODY_MAX_LENGTH,
} from './messageChannelTemplates.service';

function template(
  overrides: Partial<MessageChannelTemplate> = {},
): MessageChannelTemplate {
  return {
    id: 'template-id',
    type: MessageType.SingleUpcomingInstallment,
    channel: BrevoChannel.Email,
    subject: 'Su cuota No. {{2}} vence {{5}}',
    body: '*{{1}}*, la cuota *No. {{2}}* del pagaré {{3}} por {{4}} vence {{5}}.\n\n{{6}}',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

const SENT = {
  sent: true,
  providerMessageId: 'id',
  failureReason: null,
  errorMessage: null,
};

describe('MessageChannelTemplatesService', () => {
  let service: MessageChannelTemplatesService;
  let repository: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
  };
  let brevoService: { sendEmail: jest.Mock; sendSms: jest.Mock };

  beforeEach(async () => {
    repository = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn((entity: MessageChannelTemplate) =>
        Promise.resolve(entity),
      ),
    };
    brevoService = {
      sendEmail: jest.fn().mockResolvedValue(SENT),
      sendSms: jest.fn().mockResolvedValue(SENT),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageChannelTemplatesService,
        {
          provide: getRepositoryToken(MessageChannelTemplate),
          useValue: repository,
        },
        { provide: BrevoService, useValue: brevoService },
      ],
    }).compile();

    service = module.get(MessageChannelTemplatesService);
  });

  describe('findAll', () => {
    it("attaches each type's parameters", async () => {
      repository.find.mockResolvedValue([template()]);

      const [view] = await service.findAll();

      expect(view.parameters).toBe(
        MESSAGE_TYPE_PARAMETERS[MessageType.SingleUpcomingInstallment],
      );
      expect(view).not.toHaveProperty('id');
    });
  });

  describe('update', () => {
    it('saves a valid email template, trimmed', async () => {
      repository.findOneBy.mockResolvedValue(template());

      const view = await service.update(
        MessageType.SingleUpcomingInstallment,
        BrevoChannel.Email,
        { subject: '  Recordatorio {{2}} ', body: '  Hola {{1}}  ' },
      );

      expect(view).toMatchObject({
        subject: 'Recordatorio {{2}}',
        body: 'Hola {{1}}',
      });
      expect(repository.save).toHaveBeenCalled();
    });

    it('requires a subject for email', async () => {
      repository.findOneBy.mockResolvedValue(template());

      await expect(
        service.update(
          MessageType.SingleUpcomingInstallment,
          BrevoChannel.Email,
          { subject: '  ', body: 'Hola' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a subject on an SMS', async () => {
      repository.findOneBy.mockResolvedValue(
        template({ channel: BrevoChannel.Sms, subject: null }),
      );

      await expect(
        service.update(
          MessageType.SingleUpcomingInstallment,
          BrevoChannel.Sms,
          {
            subject: 'Asunto',
            body: 'Hola',
          },
        ),
      ).rejects.toThrow('Un SMS no lleva asunto.');
    });

    it('saves an SMS with a null subject', async () => {
      repository.findOneBy.mockResolvedValue(
        template({ channel: BrevoChannel.Sms, subject: null }),
      );

      const view = await service.update(
        MessageType.SingleUpcomingInstallment,
        BrevoChannel.Sms,
        { subject: '', body: 'Hola {{1}}' },
      );

      expect(view.subject).toBeNull();
    });

    it('rejects an SMS longer than the limit', async () => {
      repository.findOneBy.mockResolvedValue(
        template({ channel: BrevoChannel.Sms, subject: null }),
      );

      await expect(
        service.update(
          MessageType.SingleUpcomingInstallment,
          BrevoChannel.Sms,
          {
            body: 'a'.repeat(SMS_BODY_MAX_LENGTH + 1),
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a placeholder beyond the type's parameters, in body or subject", async () => {
      repository.findOneBy.mockResolvedValue(template());

      await expect(
        service.update(MessageType.PaidInFull, BrevoChannel.Email, {
          subject: 'Pagaré {{2}}',
          body: 'Hola {{1}}, total {{4}}',
        }),
      ).rejects.toThrow(/\{\{4\}\}.*\{\{1\}\} a \{\{3\}\}/);

      await expect(
        service.update(MessageType.PaidInFull, BrevoChannel.Email, {
          subject: 'Pagaré {{9}}',
          body: 'Hola {{1}}',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('throws NotFound for a missing row', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update(MessageType.PaidInFull, BrevoChannel.Email, {
          subject: 'x',
          body: 'y',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('render', () => {
    const parameters = exampleParametersFor(
      MessageType.SingleUpcomingInstallment,
    );

    it('fills subject and body of an email with the WhatsApp parameters', () => {
      const rendered = service.render(template(), parameters);

      expect(rendered.subject).toBe('Su cuota No. 3 vence en 3 días');
      expect(rendered.text).toBe(
        '*Señor/a Juana Pérez*, la cuota *No. 3* del pagaré #1021 por $150.000 vence en 3 días.\n\nGracias por su atención.',
      );
    });

    it('sends an SMS in GSM-7, accents dropped', () => {
      const rendered = service.render(
        template({
          channel: BrevoChannel.Sms,
          subject: null,
          body: '{{1}}: vence {{5}}. {{6}}',
        }),
        parameters,
      );

      expect(rendered).toEqual({
        subject: null,
        text: 'Señor/a Juana Pérez: vence en 3 dias. Gracias por su atencion.',
      });
    });
  });

  describe('sendTest', () => {
    it('sends the email template filled with examples, marked as a test', async () => {
      repository.findOneBy.mockResolvedValue(template());

      const result = await service.sendTest(
        MessageType.SingleUpcomingInstallment,
        BrevoChannel.Email,
        ' Admin@Example.com ',
      );

      expect(result).toBe(SENT);
      const [input] = brevoService.sendEmail.mock.calls[0] as [
        {
          to: string;
          subject: string;
          htmlContent: string;
          textContent: string;
        },
      ];
      expect(input.to).toBe('admin@example.com');
      expect(input.subject).toBe('[Prueba] Su cuota No. 3 vence en 3 días');
      expect(input.htmlContent).toContain(
        '<strong>Señor/a Juana Pérez</strong>',
      );
      expect(input.textContent).not.toContain('*');
    });

    it('sends the SMS template to a normalized phone', async () => {
      repository.findOneBy.mockResolvedValue(
        template({ channel: BrevoChannel.Sms, subject: null, body: '{{5}}' }),
      );

      await service.sendTest(
        MessageType.SingleUpcomingInstallment,
        BrevoChannel.Sms,
        '300 123 4567',
      );

      expect(brevoService.sendSms).toHaveBeenCalledWith({
        to: '+573001234567',
        content: 'en 3 dias',
      });
    });

    it('rejects a recipient that does not match the channel', async () => {
      repository.findOneBy.mockResolvedValue(template());
      await expect(
        service.sendTest(
          MessageType.SingleUpcomingInstallment,
          BrevoChannel.Email,
          '3001234567',
        ),
      ).rejects.toThrow(BadRequestException);

      repository.findOneBy.mockResolvedValue(
        template({ channel: BrevoChannel.Sms, subject: null }),
      );
      await expect(
        service.sendTest(
          MessageType.SingleUpcomingInstallment,
          BrevoChannel.Sms,
          'admin@example.com',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(brevoService.sendEmail).not.toHaveBeenCalled();
      expect(brevoService.sendSms).not.toHaveBeenCalled();
    });
  });
});

describe('CHANNEL_TEMPLATE_SEEDS', () => {
  it('covers every message type exactly once', () => {
    expect(CHANNEL_TEMPLATE_SEEDS.map((seed) => seed.type).sort()).toEqual(
      Object.values(MessageType).sort(),
    );
  });

  it.each(CHANNEL_TEMPLATE_SEEDS.map((seed) => [seed.type, seed]))(
    '%s only uses its own placeholders and fits the limits',
    (_type, seed) => {
      const type = seed.type as MessageType;
      const count = MESSAGE_TYPE_PARAMETERS[type].length;
      for (const text of [seed.emailSubject, seed.emailBody, seed.sms]) {
        expect(findInvalidPlaceholders(text, count)).toEqual([]);
      }
      expect(seed.emailSubject.length).toBeLessThanOrEqual(150);
      expect(seed.sms.length).toBeLessThanOrEqual(SMS_BODY_MAX_LENGTH);

      // With typical values, a seeded SMS costs at most 2 credits.
      const sms = toGsm7Text(
        renderTemplateBody(seed.sms, exampleParametersFor(type)),
      );
      expect(countSmsSegments(sms).segments).toBeLessThanOrEqual(2);
    },
  );
});
