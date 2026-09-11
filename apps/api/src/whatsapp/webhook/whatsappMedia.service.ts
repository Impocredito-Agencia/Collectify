import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Configuration } from '../../config/configuration';
import { CloudinaryUploadFolder } from '../../uploads/dto/generateCloudinarySignature.dto';
import { UploadsService } from '../../uploads/uploads.service';

const META_GRAPH_API_VERSION = 'v21.0';

interface MetaMediaMetadata {
  url: string;
  mime_type?: string;
}

// Human report, 2026-09-11 — see docs/DATABASE.md's note of this date. A
// client's photo/document/audio/video sent over WhatsApp lives on Meta's
// servers only temporarily; after that window closes, the media id this
// class is handed stops resolving to anything, permanently. This
// downloads the file the moment the webhook event arrives and re-hosts it
// on Cloudinary — the server-side counterpart to
// apps/client/src/lib/imageUpload.ts's browser-initiated uploads. Both
// paths sign through the same UploadsService (see its own comment) rather
// than each carrying their own copy of Cloudinary's signing algorithm;
// this one just calls it directly instead of over HTTP, since there's no
// browser/user involved for an inbound WhatsApp attachment.
//
// Never throws — every failure (missing credentials, Meta rejecting the
// media id, Cloudinary rejecting the upload) is logged and resolves to
// null, so a media-download failure can never break
// WhatsappWebhookService's "every inbound event is durably logged, ack
// 200 regardless" guarantee. A null result just means the message keeps
// showing its type/caption only (see WhatsappInboundMessagesPage.tsx),
// same as before this existed.
@Injectable()
export class WhatsappMediaService {
  private readonly logger = new Logger(WhatsappMediaService.name);

  constructor(
    private readonly configService: ConfigService<Configuration, true>,
    private readonly uploadsService: UploadsService,
  ) {}

  async downloadAndStore(mediaId: string): Promise<string | null> {
    const { accessToken } = this.configService.get('whatsapp', {
      infer: true,
    });

    if (!accessToken) {
      this.logger.warn(
        `WhatsApp credentials are not configured — skipping media download for ${mediaId}.`,
      );
      return null;
    }

    // Signed upfront, before touching Meta at all — same "fail fast, no
    // wasted download" behavior a direct config check would give, just
    // routed through the shared service instead of reading the Cloudinary
    // config directly. generateSignature throws ServiceUnavailableException
    // when any of the three Cloudinary vars are blank.
    let signature: ReturnType<UploadsService['generateSignature']>;
    try {
      signature = this.uploadsService.generateSignature(
        CloudinaryUploadFolder.WhatsappMedia,
      );
    } catch {
      this.logger.warn(
        `Cloudinary credentials are not configured — skipping media download for ${mediaId}. See docs/ENVIRONMENT_VARIABLES.md.`,
      );
      return null;
    }

    try {
      const metadata = await this.fetchMediaMetadata(mediaId, accessToken);
      if (!metadata) {
        return null;
      }

      const bytes = await this.downloadMediaBytes(metadata.url, accessToken);
      if (!bytes) {
        return null;
      }

      return await this.uploadToCloudinary(bytes, signature);
    } catch (error) {
      this.logger.error(
        `Failed to download/store WhatsApp media ${mediaId}`,
        error,
      );
      return null;
    }
  }

  // Meta's media id is only a reference — this first call resolves it to
  // a short-lived, authenticated download URL (and the file's real mime
  // type), which is what actually needs fetching next.
  private async fetchMediaMetadata(
    mediaId: string,
    accessToken: string,
  ): Promise<MetaMediaMetadata | null> {
    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${mediaId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      this.logger.error(
        `Meta media metadata lookup failed (${response.status}) for media ${mediaId}: ${await response.text()}`,
      );
      return null;
    }
    return (await response.json()) as MetaMediaMetadata;
  }

  // The metadata's own url still requires the same bearer token — it's
  // authenticated, not a public link.
  private async downloadMediaBytes(
    url: string,
    accessToken: string,
  ): Promise<Buffer | null> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      this.logger.error(
        `Failed to download WhatsApp media bytes (${response.status})`,
      );
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  }

  // resource_type "auto" (not "image") the same way uploadDocument() does
  // client-side — a WhatsApp attachment can be an image, a PDF, audio, or
  // video, and "auto" detects which rather than assuming it's always a
  // photo the way uploadPaymentReceipt()'s narrower "image" endpoint does.
  private async uploadToCloudinary(
    bytes: Buffer,
    signature: ReturnType<UploadsService['generateSignature']>,
  ): Promise<string | null> {
    const formData = new FormData();
    // `new Uint8Array(bytes)` rather than `bytes` directly — TS's DOM
    // lib types BlobPart against Uint8Array, not Node's Buffer subclass,
    // even though a Buffer works fine here at runtime.
    formData.append('file', new Blob([new Uint8Array(bytes)]));
    formData.append('api_key', signature.apiKey);
    formData.append('timestamp', String(signature.timestamp));
    formData.append('folder', signature.folder);
    formData.append('signature', signature.signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${signature.cloudName}/auto/upload`,
      { method: 'POST', body: formData },
    );
    if (!response.ok) {
      this.logger.error(
        `Cloudinary upload failed (${response.status}): ${await response.text()}`,
      );
      return null;
    }

    const result = (await response.json()) as { secure_url?: string };
    return result.secure_url ?? null;
  }
}
