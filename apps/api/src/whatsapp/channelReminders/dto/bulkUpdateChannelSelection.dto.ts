import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

import { UpdateChannelSelectionDto } from './updateChannelSelection.dto';

export class BulkUpdateChannelSelectionDto extends UpdateChannelSelectionDto {
  @ApiProperty({
    type: [String],
    example: ['3f6c2a52-6a4e-4b8e-9d39-2f1b8f0c1a11'],
    description: 'Clients to change (1 to 1000).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  clientIds!: string[];
}
