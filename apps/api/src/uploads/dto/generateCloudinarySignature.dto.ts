import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

// Which Cloudinary folder the upload lands in — also determines which
// resource type endpoint the client uploads to (image-only vs. auto,
// since Phase 21 documents may be PDFs). Keep in sync with the folder
// strings apps/client/src/lib/imageUpload.ts sends.
export enum CloudinaryUploadFolder {
  PaymentReceipts = 'payment-receipts',
  ClientDocuments = 'client-documents',
}

export class GenerateCloudinarySignatureDto {
  @ApiProperty({
    enum: CloudinaryUploadFolder,
    example: CloudinaryUploadFolder.PaymentReceipts,
  })
  @IsEnum(CloudinaryUploadFolder)
  folder!: CloudinaryUploadFolder;
}
