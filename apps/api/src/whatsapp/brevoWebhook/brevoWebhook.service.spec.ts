import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Client } from '../../clients/entities/client.entity';
import { MessageLog } from '../entities/messageLog.entity';
import { MessageChannel } from '../messageChannel.enum';
import { WhatsappDeliveryStatus } from '../whatsappDeliveryStatus.enum';

import { BrevoWebhookService } from './brevoWebhook.service';

const SECRET = 's3cret-value';
const EMAIL_ID = '<abc@smtp-relay.mailin.fr>';

function log(overrides: Partial<MessageLog> = {}): MessageLog {
  return {
    id: 'log-1',
    clientId: 'client-a',
    channel: MessageChannel.Email,
    email: 'juana@example.com',
    phoneNumber: null,
    providerMessageId: EMAIL_ID,
    deliveryStatus: null,
    ...overrides,
  } as MessageLog;
}

function emailEvent(event: string, extra: Record<string, unknown> = {}) {
  return {
    event,
    email: 'juana@example.com',
    'message-id': EMAIL_ID,
    ts_event: 1794247200,
    ...extra,
  };
}

function smsEvent(msgStatus: string, extra: Record<string, unknown> = {}) {
  return {
    to: '573001234567',
    messageId: 99,
    msg_status: msgStatus,
    ts_event: 1794247200,
    ...extra,
  };
}

describe('BrevoWebhookService', () => {
  let service: BrevoWebhookService;
  let secret: string;
  let messageLogsRepository: { findOne: jest.Mock; update: jest.Mock };
  let clientsRepository: {
    createQueryBuilder: jest.Mock;
    findBy: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
  };
  let queryBuilder: {
    where: jest.Mock;
    andWhere: jest.Mock;
    getMany: jest.Mock;
  };

  beforeEach(async () => {
    secret = SECRET;
    messageLogsRepository = { findOne: jest.fn(), update: jest.fn() };
    queryBuilder = {
      where: jest.fn(() => queryBuilder),
      andWhere: jest.fn(() => queryBuilder),
      getMany: jest.fn().mockResolvedValue([]),
    };
    clientsRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findBy: jest.fn().mockResolvedValue([]),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrevoWebhookService,
        {
          provide: getRepositoryToken(MessageLog),
          useValue: messageLogsRepository,
        },
        { provide: getRepositoryToken(Client), useValue: clientsRepository },
        {
          provide: ConfigService,
          useValue: { get: () => ({ webhookSecret: secret }) },
        },
      ],
    }).compile();
    service = module.get(BrevoWebhookService);
  });

  describe('assertAuthorized', () => {
    const basic = (user: string, password: string) =>
      `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

    it('accepts the secret as a Bearer token or as the Basic auth password', () => {
      expect(() => service.assertAuthorized(`Bearer ${SECRET}`)).not.toThrow();
      expect(() =>
        service.assertAuthorized(basic('brevo', SECRET)),
      ).not.toThrow();
    });

    it.each([
      [undefined],
      [''],
      ['Bearer wrong'],
      ['Bearer'],
      [basic('brevo', 'wrong')],
      [`Token ${SECRET}`],
    ])('rejects %p', (authorization) => {
      expect(() => service.assertAuthorized(authorization)).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects everything while no secret is configured', () => {
      secret = '';
      expect(() => service.assertAuthorized('Bearer ')).toThrow(
        UnauthorizedException,
      );
      expect(() => service.assertAuthorized('Bearer anything')).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('email events', () => {
    it('updates the delivery status of the matching email row', async () => {
      messageLogsRepository.findOne.mockResolvedValue(log());

      const result = await service.handle(
        MessageChannel.Email,
        emailEvent('delivered'),
      );

      expect(result).toEqual({ processed: 1 });
      const [{ where }] = messageLogsRepository.findOne.mock.calls[0] as [
        { where: { channel: MessageChannel } },
      ];
      expect(where.channel).toBe(MessageChannel.Email);
      expect(messageLogsRepository.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        {
          deliveryStatus: WhatsappDeliveryStatus.Delivered,
          deliveryStatusUpdatedAt: new Date(1794247200 * 1000),
        },
      );
      expect(clientsRepository.update).not.toHaveBeenCalled();
    });

    it('is idempotent: a repeated or late event changes nothing', async () => {
      messageLogsRepository.findOne.mockResolvedValue(
        log({ deliveryStatus: WhatsappDeliveryStatus.Delivered }),
      );

      await service.handle(MessageChannel.Email, [
        emailEvent('delivered'),
        emailEvent('request'),
      ]);

      expect(messageLogsRepository.update).not.toHaveBeenCalled();
    });

    it('fails the message and marks the client email on a hard bounce', async () => {
      messageLogsRepository.findOne.mockResolvedValue(log());
      queryBuilder.getMany.mockResolvedValue([{ id: 'client-a' }]);

      await service.handle(
        MessageChannel.Email,
        emailEvent('hard_bounce', { reason: 'no such user' }),
      );

      expect(messageLogsRepository.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        expect.objectContaining({
          deliveryStatus: WhatsappDeliveryStatus.Failed,
          lastErrorTitle: 'hard_bounce: no such user',
        }),
      );
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'LOWER(TRIM(client.email)) = :address',
        { address: 'juana@example.com' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'client.id = :clientId',
        { clientId: 'client-a' },
      );
      expect(clientsRepository.update).toHaveBeenCalledWith(
        { id: 'client-a' },
        {
          emailUndeliverableAt: new Date(1794247200 * 1000),
          emailUndeliverableReason: 'hard_bounce: no such user',
        },
      );
    });

    it('marks the email on spam without touching the delivered status', async () => {
      messageLogsRepository.findOne.mockResolvedValue(
        log({ deliveryStatus: WhatsappDeliveryStatus.Delivered }),
      );
      queryBuilder.getMany.mockResolvedValue([{ id: 'client-a' }]);

      await service.handle(MessageChannel.Email, emailEvent('spam'));

      expect(messageLogsRepository.update).not.toHaveBeenCalled();
      expect(clientsRepository.update).toHaveBeenCalledWith(
        { id: 'client-a' },
        expect.objectContaining({ emailUndeliverableReason: 'spam' }),
      );
    });

    it('records a soft bounce reason only while the message has not arrived', async () => {
      messageLogsRepository.findOne.mockResolvedValueOnce(log());
      await service.handle(
        MessageChannel.Email,
        emailEvent('soft_bounce', { reason: 'mailbox full' }),
      );
      expect(messageLogsRepository.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        { lastErrorTitle: 'soft_bounce: mailbox full' },
      );

      messageLogsRepository.update.mockClear();
      messageLogsRepository.findOne.mockResolvedValueOnce(
        log({ deliveryStatus: WhatsappDeliveryStatus.Read }),
      );
      await service.handle(MessageChannel.Email, emailEvent('soft_bounce'));
      expect(messageLogsRepository.update).not.toHaveBeenCalled();
      expect(clientsRepository.update).not.toHaveBeenCalled();
    });

    it('ignores an unknown message id, but still blocks the address it names', async () => {
      messageLogsRepository.findOne.mockResolvedValue(null);
      queryBuilder.getMany.mockResolvedValue([{ id: 'client-z' }]);

      await service.handle(MessageChannel.Email, emailEvent('unsubscribed'));

      expect(messageLogsRepository.update).not.toHaveBeenCalled();
      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
        'client.id = :clientId',
        expect.anything(),
      );
      expect(clientsRepository.update).toHaveBeenCalledWith(
        { id: 'client-z' },
        expect.objectContaining({ emailUndeliverableReason: 'unsubscribed' }),
      );
    });

    it('keeps processing the batch when one event fails', async () => {
      messageLogsRepository.findOne
        .mockRejectedValueOnce(new Error('DB down'))
        .mockResolvedValueOnce(log());

      const result = await service.handle(MessageChannel.Email, [
        emailEvent('delivered'),
        emailEvent('delivered'),
      ]);

      expect(result).toEqual({ processed: 1 });
    });
  });

  describe('SMS events', () => {
    const smsLog = (overrides: Partial<MessageLog> = {}) =>
      log({
        channel: MessageChannel.Sms,
        email: null,
        phoneNumber: '+573001234567',
        providerMessageId: '99',
        ...overrides,
      });

    it('stops SMS to the number of a hard-bounced message', async () => {
      messageLogsRepository.findOne.mockResolvedValue(smsLog());
      clientsRepository.findBy.mockResolvedValue([
        { id: 'client-a', smsUndeliverablePhoneNumbers: ['+573009999999'] },
      ]);

      await service.handle(MessageChannel.Sms, smsEvent('hard_bounce'));

      expect(messageLogsRepository.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        expect.objectContaining({
          deliveryStatus: WhatsappDeliveryStatus.Failed,
        }),
      );
      expect(clientsRepository.update).toHaveBeenCalledWith(
        { id: 'client-a' },
        {
          smsUndeliverablePhoneNumbers: ['+573009999999', '+573001234567'],
        },
      );
    });

    it('does not add a number twice', async () => {
      messageLogsRepository.findOne.mockResolvedValue(smsLog());
      clientsRepository.findBy.mockResolvedValue([
        { id: 'client-a', smsUndeliverablePhoneNumbers: ['+573001234567'] },
      ]);

      await service.handle(MessageChannel.Sms, smsEvent('unsubscribed'));

      expect(clientsRepository.update).not.toHaveBeenCalled();
    });

    it('honors a STOP for an unknown message by the client number', async () => {
      messageLogsRepository.findOne.mockResolvedValue(null);
      clientsRepository.find.mockResolvedValue([
        { id: 'client-b', smsUndeliverablePhoneNumbers: [] },
      ]);

      await service.handle(MessageChannel.Sms, smsEvent('unsubscribed'));

      expect(clientsRepository.find).toHaveBeenCalledWith({
        where: [
          { phoneNumber: '+573001234567' },
          { alternatePhoneNumber: '+573001234567' },
        ],
      });
      expect(clientsRepository.update).toHaveBeenCalledWith(
        { id: 'client-b' },
        { smsUndeliverablePhoneNumbers: ['+573001234567'] },
      );
    });

    it('marks a delivered SMS without blocking anything', async () => {
      messageLogsRepository.findOne.mockResolvedValue(smsLog());

      await service.handle(MessageChannel.Sms, smsEvent('delivered'));

      expect(messageLogsRepository.update).toHaveBeenCalledWith(
        { id: 'log-1' },
        expect.objectContaining({
          deliveryStatus: WhatsappDeliveryStatus.Delivered,
        }),
      );
      expect(clientsRepository.update).not.toHaveBeenCalled();
    });
  });
});
