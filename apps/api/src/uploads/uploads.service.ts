import { createHash } from 'crypto';

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Configuration } from '../config/configuration';

import { CloudinaryUploadFolder } from './dto/generateCloudinarySignature.dto';

export interface CloudinarySignature {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: CloudinaryUploadFolder;
}

@Injectable()
export class UploadsService {
  constructor(
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  generateSignature(folder: CloudinaryUploadFolder): CloudinarySignature {
    const { cloudName, apiKey, apiSecret } = this.configService.get(
      'cloudinary',
      { infer: true },
    );

    if (!cloudName || !apiKey || !apiSecret) {
      // Mirrors the "pending credentials" pattern ENVIRONMENT_VARIABLES.md
      // documents for the Meta WhatsApp vars, adapted to a synchronous
      // user action (uploading a photo) rather than a background job —
      // there's no reasonable "skip silently" behavior here, same
      // reasoning the old client-side ImageUploadError used.
      throw new ServiceUnavailableException(
        'La subida de archivos no está configurada todavía (faltan las credenciales de Cloudinary).',
      );
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signParams({ folder, timestamp }, apiSecret);

    return { signature, timestamp, apiKey, cloudName, folder };
  }
}

// Cloudinary's signing algorithm: every param that will be sent with the
// upload (except file/cloud_name/api_key/signature/resource_type), sorted
// alphabetically by key as "key=value" pairs joined with "&", with the api
// secret appended directly (no separator) — then SHA-1 hex digested. The
// client must send exactly these same params or Cloudinary rejects the
// signature. See https://cloudinary.com/documentation/signatures
function signParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const sortedParamString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return createHash('sha1')
    .update(sortedParamString + apiSecret)
    .digest('hex');
}
