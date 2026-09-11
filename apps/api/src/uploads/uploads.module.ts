import { Module } from '@nestjs/common';

import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
  // Exported for WhatsappModule's WhatsappMediaService, which signs its
  // own server-side Cloudinary uploads through this same service rather
  // than duplicating the signing algorithm.
  exports: [UploadsService],
})
export class UploadsModule {}
