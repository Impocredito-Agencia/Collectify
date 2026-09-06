import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { WhatsAppService } from './whatsapp.service';

describe('WhatsAppService', () => {
  let service: WhatsAppService;
  let configService: { get: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    configService = { get: jest.fn() };
    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<WhatsAppService>(WhatsAppService);
  });

  it('skips the send and returns false when credentials are not configured', async () => {
    configService.get.mockReturnValue({ phoneNumberId: '', accessToken: '' });

    const result = await service.sendTextMessage('+573001234567', 'hello');

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the send and returns false when sending is globally paused, even with valid credentials', async () => {
    configService.get.mockReturnValue({
      phoneNumberId: 'phone-id',
      accessToken: 'token',
      sendingPaused: true,
    });

    const result = await service.sendTextMessage('+573001234567', 'hello');

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the message and returns true when the API responds ok', async () => {
    configService.get.mockReturnValue({
      phoneNumberId: 'phone-id',
      accessToken: 'token',
    });
    fetchMock.mockResolvedValue({ ok: true });

    const result = await service.sendTextMessage('+573001234567', 'hello');

    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/phone-id/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
  });

  it('returns false when the API responds with a non-ok status', async () => {
    configService.get.mockReturnValue({
      phoneNumberId: 'phone-id',
      accessToken: 'token',
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Invalid phone number'),
    });

    const result = await service.sendTextMessage('+573001234567', 'hello');

    expect(result).toBe(false);
  });

  it('returns false when the request throws', async () => {
    configService.get.mockReturnValue({
      phoneNumberId: 'phone-id',
      accessToken: 'token',
    });
    fetchMock.mockRejectedValue(new Error('network error'));

    const result = await service.sendTextMessage('+573001234567', 'hello');

    expect(result).toBe(false);
  });

  describe('sendTemplateMessage', () => {
    it('skips the send and returns sent: false when credentials are not configured', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: '',
        accessToken: '',
      });

      const result = await service.sendTemplateMessage(
        '+573001234567',
        'una_cuota_vencida',
        'es',
        ['Señor Juan', '2', '#100', '$50.000', 'hace 3 días', 'Nota'],
      );

      expect(result).toEqual({ sent: false, whatsappMessageId: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips the send and returns sent: false when sending is globally paused', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
        sendingPaused: true,
      });

      const result = await service.sendTemplateMessage(
        '+573001234567',
        'una_cuota_vencida',
        'es',
        ['Señor Juan'],
      );

      expect(result).toEqual({ sent: false, whatsappMessageId: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends a type: template request with the parameters in order, returning the WAMID', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
      });
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [{ id: 'wamid.HBgMNTczM' }] }),
      });

      const result = await service.sendTemplateMessage(
        '+573001234567',
        'una_cuota_vencida',
        'es',
        ['Señor Juan', '2', '#100'],
      );

      expect(result).toEqual({
        sent: true,
        whatsappMessageId: 'wamid.HBgMNTczM',
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/phone-id/messages');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as {
        type: string;
        template: {
          name: string;
          language: { code: string };
          components: Array<{
            type: string;
            parameters: Array<{ type: string; text: string }>;
          }>;
        };
      };
      expect(body.type).toBe('template');
      expect(body.template.name).toBe('una_cuota_vencida');
      expect(body.template.language.code).toBe('es');
      expect(body.template.components).toEqual([
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Señor Juan' },
            { type: 'text', text: '2' },
            { type: 'text', text: '#100' },
          ],
        },
      ]);
    });

    it('returns sent: false when the API responds with a non-ok status', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
      });
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Template not found'),
      });

      const result = await service.sendTemplateMessage(
        '+573001234567',
        'una_cuota_vencida',
        'es',
        ['Señor Juan'],
      );

      expect(result).toEqual({ sent: false, whatsappMessageId: null });
    });

    it('returns sent: false when the request throws', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
      });
      fetchMock.mockRejectedValue(new Error('network error'));

      const result = await service.sendTemplateMessage(
        '+573001234567',
        'una_cuota_vencida',
        'es',
        ['Señor Juan'],
      );

      expect(result).toEqual({ sent: false, whatsappMessageId: null });
    });

    it('returns whatsappMessageId: null when the API accepts the send but omits it', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
      });
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await service.sendTemplateMessage(
        '+573001234567',
        'una_cuota_vencida',
        'es',
        ['Señor Juan'],
      );

      expect(result).toEqual({ sent: true, whatsappMessageId: null });
    });
  });

  describe('sendInteractiveButtonsMessage', () => {
    const buttons = [
      { id: 'menu_mi_cuenta', title: 'Mi cuenta' },
      { id: 'menu_reportar_pago', title: 'Reportar un pago' },
      { id: 'menu_hablar_asesor', title: 'Hablar con asesor' },
    ];

    it('skips the send and returns false when credentials are not configured', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: '',
        accessToken: '',
      });

      const result = await service.sendInteractiveButtonsMessage(
        '+573001234567',
        'Selecciona una opción:',
        buttons,
      );

      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips the send and returns false when sending is globally paused', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
        sendingPaused: true,
      });

      const result = await service.sendInteractiveButtonsMessage(
        '+573001234567',
        'Selecciona una opción:',
        buttons,
      );

      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns false and skips the send when there are no buttons', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
      });

      const result = await service.sendInteractiveButtonsMessage(
        '+573001234567',
        'Selecciona una opción:',
        [],
      );

      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns false and skips the send when there are more than 3 buttons', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
      });

      const result = await service.sendInteractiveButtonsMessage(
        '+573001234567',
        'Selecciona una opción:',
        [...buttons, { id: 'menu_extra', title: 'Extra' }],
      );

      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends a type: interactive request with the buttons in order', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
      });
      fetchMock.mockResolvedValue({ ok: true });

      const result = await service.sendInteractiveButtonsMessage(
        '+573001234567',
        'Selecciona una opción:',
        buttons,
      );

      expect(result).toBe(true);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/phone-id/messages');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as {
        type: string;
        interactive: {
          type: string;
          body: { text: string };
          action: {
            buttons: Array<{
              type: string;
              reply: { id: string; title: string };
            }>;
          };
        };
      };
      expect(body.type).toBe('interactive');
      expect(body.interactive.type).toBe('button');
      expect(body.interactive.body.text).toBe('Selecciona una opción:');
      expect(body.interactive.action.buttons).toEqual([
        { type: 'reply', reply: { id: 'menu_mi_cuenta', title: 'Mi cuenta' } },
        {
          type: 'reply',
          reply: { id: 'menu_reportar_pago', title: 'Reportar un pago' },
        },
        {
          type: 'reply',
          reply: { id: 'menu_hablar_asesor', title: 'Hablar con asesor' },
        },
      ]);
    });

    it('returns false when the API responds with a non-ok status', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
      });
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid buttons'),
      });

      const result = await service.sendInteractiveButtonsMessage(
        '+573001234567',
        'Selecciona una opción:',
        buttons,
      );

      expect(result).toBe(false);
    });

    it('returns false when the request throws', async () => {
      configService.get.mockReturnValue({
        phoneNumberId: 'phone-id',
        accessToken: 'token',
      });
      fetchMock.mockRejectedValue(new Error('network error'));

      const result = await service.sendInteractiveButtonsMessage(
        '+573001234567',
        'Selecciona una opción:',
        buttons,
      );

      expect(result).toBe(false);
    });
  });
});
