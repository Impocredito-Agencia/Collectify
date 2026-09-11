import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { GenerateCloudinarySignatureDto } from './dto/generateCloudinarySignature.dto';
import { UploadsService } from './uploads.service';

import type { CloudinarySignature } from './uploads.service';

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('cloudinary-signature')
  @ApiOperation({
    summary: 'Generate a short-lived signed Cloudinary upload payload',
    description:
      'Authenticated users only, via the global JwtAuthGuard — every ' +
      'signed upload this returns is tied to a logged-in session, unlike ' +
      'the old unsigned preset anyone could call directly with just the ' +
      'public cloud name and preset name copied out of the client bundle. ' +
      'The client uploads the file bytes straight to Cloudinary using this ' +
      'payload; the api never receives the file itself.',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns the signed upload payload.',
  })
  generateSignature(
    @Body() dto: GenerateCloudinarySignatureDto,
  ): CloudinarySignature {
    return this.uploadsService.generateSignature(dto.folder);
  }
}
