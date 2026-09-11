import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

// Which Cloudinary folder the upload lands in — also determines which
// resource type endpoint the uploader uses (image-only vs. auto, since
// Phase 21 documents may be PDFs and WhatsApp attachments can be anything).
// PaymentReceipts/ClientDocuments are requested through this DTO by an
// authenticated browser session (see
// apps/client/src/lib/imageUpload.ts — keep those folder strings in
// sync); WhatsappMedia is signed server-side only, by WhatsappMediaService
// re-hosting a client's inbound attachment — never requested through this
// endpoint, since there's no browser/user involved for an inbound event.
export enum CloudinaryUploadFolder {
  PaymentReceipts = 'payment-receipts',
  ClientDocuments = 'client-documents',
  WhatsappMedia = 'whatsapp-media',
}

// Only these two are ever requested by an authenticated browser session
// through this endpoint — WhatsappMedia is excluded on purpose (see the
// enum's own comment above), validated with @IsIn instead of @IsEnum so a
// request for it is rejected the same way an unrelated string would be.
const BROWSER_UPLOAD_FOLDERS = [
  CloudinaryUploadFolder.PaymentReceipts,
  CloudinaryUploadFolder.ClientDocuments,
] as const;

export class GenerateCloudinarySignatureDto {
  @ApiProperty({
    enum: BROWSER_UPLOAD_FOLDERS,
    example: CloudinaryUploadFolder.PaymentReceipts,
  })
  @IsIn(BROWSER_UPLOAD_FOLDERS)
  folder!: CloudinaryUploadFolder;
}
