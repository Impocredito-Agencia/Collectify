import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import {
  BrevoService,
  TEST_EMAIL_SUBJECT,
  TEST_SMS_CONTENT,
} from './brevo.service';
import { BrevoChannel, BrevoSendFailureReason } from './brevoTypes';

import type { BrevoConfig } from '../config/configuration';

const PHONE = '+573001234567';
const EMAIL = 'cliente@example.com';

function buildConfig(overrides: Partial<BrevoConfig> = {}): BrevoConfig {
  return {
    apiKey: 'xkeysib-test',
    senderEmail: 'cobros@example.com',
    senderName: 'Collectify',
    smsSender: 'Collectify',
    emailSendingPaused: false,
    smsSendingPaused: false,
    testRecipients: [],
    webhookSecret: '',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('BrevoService', () => {
  let service: BrevoService;
  let configService: { get: jest.Mock };
  let fetchMock: jest.Mock;

  const useConfig = (overrides: Partial<BrevoConfig> = {}) =>
    configService.get.mockReturnValue(buildConfig(overrides));

  const lastRequest = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return {
      url,
      init,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    };
  };

  beforeEach(async () => {
    configService = { get: jest.fn() };
    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrevoService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<BrevoService>(BrevoService);
  });

  describe('sendEmail', () => {
    const input = {
      to: EMAIL,
      subject: 'Asunto',
      htmlContent: '<p>Hola</p>',
      textContent: 'Hola',
    };

    it('posts the transactional email payload and returns Brevo messageId', async () => {
      useConfig();
      fetchMock.mockResolvedValue(
        jsonResponse(201, { messageId: '<2017@relay.brevo.com>' }),
      );

      const result = await service.sendEmail(input);

      expect(result).toEqual({
        sent: true,
        providerMessageId: '<2017@relay.brevo.com>',
        failureReason: null,
        errorMessage: null,
      });
      const { url, init, body } = lastRequest();
      expect(url).toBe('https://api.brevo.com/v3/smtp/email');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({ 'api-key': 'xkeysib-test' });
      expect(body).toEqual({
        sender: { email: 'cobros@example.com', name: 'Collectify' },
        to: [{ email: EMAIL }],
        subject: 'Asunto',
        htmlContent: '<p>Hola</p>',
        textContent: 'Hola',
      });
    });

    it('omits the sender name when none is configured', async () => {
      useConfig({ senderName: '' });
      fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 'id' }));

      await service.sendEmail(input);

      expect(lastRequest().body.sender).toEqual({
        email: 'cobros@example.com',
      });
    });

    it('lowercases and trims the recipient', async () => {
      useConfig();
      fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 'id' }));

      await service.sendEmail({ ...input, to: '  Cliente@Example.COM ' });

      expect(lastRequest().body.to).toEqual([{ email: EMAIL }]);
    });

    it('skips without calling Brevo when the API key is missing', async () => {
      useConfig({ apiKey: '' });

      const result = await service.sendEmail(input);

      expect(result).toMatchObject({
        sent: false,
        failureReason: BrevoSendFailureReason.NotConfigured,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips without calling Brevo when the sender email is missing', async () => {
      useConfig({ senderEmail: '' });

      const result = await service.sendEmail(input);

      expect(result.failureReason).toBe(BrevoSendFailureReason.NotConfigured);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips when email sending is paused', async () => {
      useConfig({ emailSendingPaused: true });

      const result = await service.sendEmail(input);

      expect(result.failureReason).toBe(BrevoSendFailureReason.Paused);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends to a test recipient while paused, matching case-insensitively', async () => {
      useConfig({ emailSendingPaused: true, testRecipients: [EMAIL] });
      fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 'id' }));

      const result = await service.sendEmail({
        ...input,
        to: 'CLIENTE@example.com',
      });

      expect(result.sent).toBe(true);
    });

    it('is not unblocked by an SMS pause being off', async () => {
      useConfig({ emailSendingPaused: true, smsSendingPaused: false });

      const result = await service.sendEmail(input);

      expect(result.failureReason).toBe(BrevoSendFailureReason.Paused);
    });
  });

  describe('sendSms', () => {
    it('posts to the current transactional SMS endpoint without the leading +', async () => {
      useConfig();
      fetchMock.mockResolvedValue(
        jsonResponse(201, { messageId: 1511882900100020 }),
      );

      const result = await service.sendSms({ to: PHONE, content: 'Hola' });

      expect(result).toEqual({
        sent: true,
        providerMessageId: '1511882900100020',
        failureReason: null,
        errorMessage: null,
      });
      const { url, body } = lastRequest();
      expect(url).toBe('https://api.brevo.com/v3/transactionalSMS/send');
      expect(body).toEqual({
        sender: 'Collectify',
        recipient: '573001234567',
        content: 'Hola',
        type: 'transactional',
      });
    });

    it('skips when SMS sending is paused', async () => {
      useConfig({ smsSendingPaused: true });

      const result = await service.sendSms({ to: PHONE, content: 'Hola' });

      expect(result.failureReason).toBe(BrevoSendFailureReason.Paused);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a pause before a missing configuration', async () => {
      useConfig({ smsSendingPaused: true, apiKey: '' });

      const result = await service.sendSms({ to: PHONE, content: 'Hola' });

      expect(result.failureReason).toBe(BrevoSendFailureReason.Paused);
    });

    it('sends to a test phone while paused', async () => {
      useConfig({ smsSendingPaused: true, testRecipients: [PHONE] });
      fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 1 }));

      const result = await service.sendSms({ to: PHONE, content: 'Hola' });

      expect(result.sent).toBe(true);
    });

    it('does not let a test email unblock an SMS to another number', async () => {
      useConfig({ smsSendingPaused: true, testRecipients: [EMAIL] });

      const result = await service.sendSms({ to: PHONE, content: 'Hola' });

      expect(result.failureReason).toBe(BrevoSendFailureReason.Paused);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips when the SMS sender is missing', async () => {
      useConfig({ smsSender: '' });

      const result = await service.sendSms({ to: PHONE, content: 'Hola' });

      expect(result.failureReason).toBe(BrevoSendFailureReason.NotConfigured);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('Brevo errors', () => {
    const send = () => service.sendSms({ to: PHONE, content: 'Hola' });

    it.each([
      [
        401,
        { code: 'unauthorized', message: 'Key not found' },
        BrevoSendFailureReason.InvalidApiKey,
      ],
      [
        402,
        { code: 'not_enough_credits', message: 'Not enough credits' },
        BrevoSendFailureReason.InsufficientCredits,
      ],
      [
        400,
        { code: 'Insufficient credits', message: 'No SMS credits left' },
        BrevoSendFailureReason.InsufficientCredits,
      ],
      [
        429,
        { code: 'too_many_requests', message: 'Rate limit' },
        BrevoSendFailureReason.RateLimited,
      ],
      [
        400,
        { code: 'invalid_parameter', message: 'Invalid recipient' },
        BrevoSendFailureReason.Rejected,
      ],
      [500, null, BrevoSendFailureReason.Rejected],
    ])(
      'maps a %i response to its failure reason',
      async (status, body, failureReason) => {
        useConfig();
        fetchMock.mockResolvedValue(jsonResponse(status, body));

        const result = await send();

        expect(result).toMatchObject({
          sent: false,
          providerMessageId: null,
          failureReason,
        });
      },
    );

    it("keeps Brevo's own message", async () => {
      useConfig();
      fetchMock.mockResolvedValue(
        jsonResponse(400, {
          code: 'invalid_parameter',
          message: 'recipient is invalid',
        }),
      );

      const result = await send();

      expect(result.errorMessage).toBe('recipient is invalid');
    });

    it('falls back to the status when the error body is not JSON', async () => {
      useConfig();
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      const result = await send();

      expect(result).toMatchObject({
        failureReason: BrevoSendFailureReason.Rejected,
        errorMessage: 'Brevo responded with 503',
      });
    });

    it('returns a network error instead of throwing when Brevo is unreachable', async () => {
      useConfig();
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await send();

      expect(result.failureReason).toBe(BrevoSendFailureReason.NetworkError);
    });
  });

  describe('sendTestMessage', () => {
    it('sends the fixed SMS text, which fits one GSM-7 segment', async () => {
      useConfig();
      fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 1 }));

      await service.sendTestMessage(BrevoChannel.Sms, PHONE);

      expect(lastRequest().body.content).toBe(TEST_SMS_CONTENT);
      expect(TEST_SMS_CONTENT.length).toBeLessThanOrEqual(160);
      expect(TEST_SMS_CONTENT).toMatch(/^[A-Za-z0-9 .,:;!?'-]*$/);
    });

    it('sends the fixed test email', async () => {
      useConfig();
      fetchMock.mockResolvedValue(jsonResponse(201, { messageId: 'id' }));

      await service.sendTestMessage(BrevoChannel.Email, EMAIL);

      const { url, body } = lastRequest();
      expect(url).toContain('/smtp/email');
      expect(body.subject).toBe(TEST_EMAIL_SUBJECT);
    });
  });

  describe('getAccountInfo', () => {
    it('reads the main plan and the SMS credits from the plan list', async () => {
      useConfig();
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          plan: [
            { type: 'free', credits: 250, creditsType: 'sendLimit' },
            { type: 'sms', credits: 15, creditsType: 'sendLimit' },
          ],
        }),
      );

      const result = await service.getAccountInfo();

      expect(result).toEqual({
        available: true,
        planType: 'free',
        emailCredits: 250,
        smsCredits: 15,
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.brevo.com/v3/account');
      expect(init.headers).toMatchObject({ 'api-key': 'xkeysib-test' });
    });

    it('reports null SMS credits when the account never bought any', async () => {
      useConfig();
      fetchMock.mockResolvedValue(
        jsonResponse(200, { plan: [{ type: 'free', credits: 300 }] }),
      );

      const result = await service.getAccountInfo();

      expect(result).toMatchObject({ available: true, smsCredits: null });
    });

    it('does not call Brevo without an API key', async () => {
      useConfig({ apiKey: '' });

      const result = await service.getAccountInfo();

      expect(result).toMatchObject({
        available: false,
        failureReason: BrevoSendFailureReason.NotConfigured,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports an invalid key', async () => {
      useConfig();
      fetchMock.mockResolvedValue(
        jsonResponse(401, { code: 'unauthorized', message: 'Key not found' }),
      );

      const result = await service.getAccountInfo();

      expect(result).toEqual({
        available: false,
        failureReason: BrevoSendFailureReason.InvalidApiKey,
        errorMessage: 'Key not found',
      });
    });

    it('reports a network error instead of throwing', async () => {
      useConfig();
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await service.getAccountInfo();

      expect(result).toMatchObject({
        available: false,
        failureReason: BrevoSendFailureReason.NetworkError,
      });
    });
  });

  describe('getStatus', () => {
    it('reports each channel and never includes the API key', async () => {
      useConfig({ smsSendingPaused: true, testRecipients: [EMAIL, PHONE] });
      fetchMock.mockResolvedValue(
        jsonResponse(200, { plan: [{ type: 'free', credits: 300 }] }),
      );

      const status = await service.getStatus();

      expect(status).toEqual({
        apiKeyConfigured: true,
        email: {
          configured: true,
          sendingPaused: false,
          sender: 'cobros@example.com',
        },
        sms: { configured: true, sendingPaused: true, sender: 'Collectify' },
        testRecipientsCount: 2,
        webhookConfigured: false,
        account: {
          available: true,
          planType: 'free',
          emailCredits: 300,
          smsCredits: null,
        },
      });
      expect(JSON.stringify(status)).not.toContain('xkeysib-test');
    });

    it('reports whether the webhook secret is set, never the secret', async () => {
      useConfig({ apiKey: '', webhookSecret: 'hook-secret' });

      const status = await service.getStatus();

      expect(status.webhookConfigured).toBe(true);
      expect(JSON.stringify(status)).not.toContain('hook-secret');
    });

    it('marks both channels unconfigured without an API key', async () => {
      useConfig({ apiKey: '' });

      const status = await service.getStatus();

      expect(status.apiKeyConfigured).toBe(false);
      expect(status.email.configured).toBe(false);
      expect(status.sms.configured).toBe(false);
    });
  });
});
