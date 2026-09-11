import { createHash } from 'crypto';

import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { CloudinaryUploadFolder } from './dto/generateCloudinarySignature.dto';
import { UploadsService } from './uploads.service';

describe('UploadsService', () => {
  let service: UploadsService;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockReturnValue({
        cloudName: 'demo-cloud',
        apiKey: 'demo-key',
        apiSecret: 'demo-secret',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateSignature', () => {
    it("returns a signature matching Cloudinary's documented signing algorithm", () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_726_000_000_000);

      const result = service.generateSignature(
        CloudinaryUploadFolder.PaymentReceipts,
      );

      const expectedTimestamp = Math.floor(1_726_000_000_000 / 1000);
      const expectedSignature = createHash('sha1')
        .update(
          `folder=${CloudinaryUploadFolder.PaymentReceipts}&timestamp=${expectedTimestamp}demo-secret`,
        )
        .digest('hex');

      expect(result).toEqual({
        signature: expectedSignature,
        timestamp: expectedTimestamp,
        apiKey: 'demo-key',
        cloudName: 'demo-cloud',
        folder: CloudinaryUploadFolder.PaymentReceipts,
      });
    });

    it('produces a different signature for a different folder', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_726_000_000_000);

      const receipts = service.generateSignature(
        CloudinaryUploadFolder.PaymentReceipts,
      );
      const documents = service.generateSignature(
        CloudinaryUploadFolder.ClientDocuments,
      );

      expect(receipts.signature).not.toEqual(documents.signature);
    });

    it('throws when the Cloudinary credentials are not configured yet', () => {
      configService.get.mockReturnValue({
        cloudName: '',
        apiKey: '',
        apiSecret: '',
      });

      expect(() =>
        service.generateSignature(CloudinaryUploadFolder.PaymentReceipts),
      ).toThrow(ServiceUnavailableException);
    });

    it('throws when only the api secret is missing', () => {
      configService.get.mockReturnValue({
        cloudName: 'demo-cloud',
        apiKey: 'demo-key',
        apiSecret: '',
      });

      expect(() =>
        service.generateSignature(CloudinaryUploadFolder.PaymentReceipts),
      ).toThrow(ServiceUnavailableException);
    });
  });
});
