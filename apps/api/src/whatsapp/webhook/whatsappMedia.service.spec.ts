import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { CloudinaryUploadFolder } from '../../uploads/dto/generateCloudinarySignature.dto';
import { UploadsService } from '../../uploads/uploads.service';

import { WhatsappMediaService } from './whatsappMedia.service';

describe('WhatsappMediaService', () => {
  let service: WhatsappMediaService;
  let configService: { get: jest.Mock };
  let uploadsService: { generateSignature: jest.Mock };
  let fetchMock: jest.Mock;

  const WHATSAPP_CONFIG = { accessToken: 'meta-token' };
  const SIGNATURE = {
    signature: 'sig',
    timestamp: 1700000000,
    apiKey: 'api-key',
    cloudName: 'demo',
    folder: CloudinaryUploadFolder.WhatsappMedia,
  };

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockReturnValue(WHATSAPP_CONFIG),
    };
    uploadsService = {
      generateSignature: jest.fn().mockReturnValue(SIGNATURE),
    };
    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappMediaService,
        { provide: ConfigService, useValue: configService },
        { provide: UploadsService, useValue: uploadsService },
      ],
    }).compile();

    service = module.get<WhatsappMediaService>(WhatsappMediaService);
  });

  it('returns null and skips the network entirely when WhatsApp credentials are not configured', async () => {
    configService.get.mockReturnValue({ accessToken: '' });

    const result = await service.downloadAndStore('media-1');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadsService.generateSignature).not.toHaveBeenCalled();
  });

  it('returns null and skips the network entirely when Cloudinary credentials are not configured', async () => {
    uploadsService.generateSignature.mockImplementation(() => {
      throw new ServiceUnavailableException('Cloudinary is not configured.');
    });

    const result = await service.downloadAndStore('media-1');

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs the upload through UploadsService for the whatsapp-media folder', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(''),
    });

    await service.downloadAndStore('media-1');

    expect(uploadsService.generateSignature).toHaveBeenCalledWith(
      CloudinaryUploadFolder.WhatsappMedia,
    );
  });

  it('returns null when Meta rejects the media id lookup', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Unsupported get request'),
    });

    const result = await service.downloadAndStore('media-1');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when downloading the media bytes fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ url: 'https://lookaside.fbsbx.com/media-1' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve(''),
      });

    const result = await service.downloadAndStore('media-1');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when Cloudinary rejects the upload', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ url: 'https://lookaside.fbsbx.com/media-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid signature'),
      });

    const result = await service.downloadAndStore('media-1');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns the Cloudinary secure_url on the full success path', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            url: 'https://lookaside.fbsbx.com/media-1',
            mime_type: 'image/jpeg',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            secure_url:
              'https://res.cloudinary.com/demo/image/upload/media-1.jpg',
          }),
      });

    const result = await service.downloadAndStore('media-1');

    expect(result).toBe(
      'https://res.cloudinary.com/demo/image/upload/media-1.jpg',
    );
    // First call: Meta metadata lookup, authenticated with the WhatsApp
    // access token.
    const [metadataUrl, metadataInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(metadataUrl).toContain('/media-1');
    expect(metadataInit.headers).toMatchObject({
      Authorization: 'Bearer meta-token',
    });
    // Third call: the Cloudinary upload, hitting the "auto" endpoint (not
    // "image") so a PDF/audio/video attachment uploads correctly too, and
    // carrying the signed payload UploadsService returned.
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[2] as [
      string,
      RequestInit,
    ];
    expect(uploadUrl).toBe('https://api.cloudinary.com/v1_1/demo/auto/upload');
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.body).toBeInstanceOf(FormData);
  });

  it('never throws — an unexpected network error resolves to null', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));

    await expect(service.downloadAndStore('media-1')).resolves.toBeNull();
  });

  // Human report, 2026-09-14 — backs audio/video playback without ever
  // touching Cloudinary (unlike downloadAndStore above).
  describe('fetchMediaBytes', () => {
    it('returns null and skips the network entirely when WhatsApp credentials are not configured', async () => {
      configService.get.mockReturnValue({ accessToken: '' });

      const result = await service.fetchMediaBytes('media-9');

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never touches Cloudinary — no signature is generated', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              url: 'https://lookaside.fbsbx.com/media-9',
              mime_type: 'audio/ogg',
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
        });

      await service.fetchMediaBytes('media-9');

      expect(uploadsService.generateSignature).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('returns the bytes and mime type on success', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              url: 'https://lookaside.fbsbx.com/media-9',
              mime_type: 'video/mp4',
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
        });

      const result = await service.fetchMediaBytes('media-9');

      expect(result).toEqual({
        bytes: Buffer.alloc(4),
        mimeType: 'video/mp4',
      });
    });

    it('falls back to a generic mime type when Meta does not report one', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ url: 'https://lookaside.fbsbx.com/media-9' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
        });

      const result = await service.fetchMediaBytes('media-9');

      expect(result?.mimeType).toBe('application/octet-stream');
    });

    it('returns null when Meta rejects the media id lookup', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Unsupported get request'),
      });

      const result = await service.fetchMediaBytes('media-9');

      expect(result).toBeNull();
    });

    it('returns null when downloading the media bytes fails', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ url: 'https://lookaside.fbsbx.com/media-9' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: () => Promise.resolve(''),
        });

      const result = await service.fetchMediaBytes('media-9');

      expect(result).toBeNull();
    });

    it('never throws — an unexpected network error resolves to null', async () => {
      fetchMock.mockRejectedValue(new Error('network error'));

      await expect(service.fetchMediaBytes('media-9')).resolves.toBeNull();
    });
  });
});
