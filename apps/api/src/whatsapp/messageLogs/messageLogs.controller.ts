import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequireModule } from '../../auth/decorators/requireModule.decorator';
import { PaginatedResult } from '../../common/interfaces/paginatedResult.interface';
import { AppModule } from '../../users/entities/userModulePermission.entity';
import { Audit } from '../../auditLog/decorators/audit.decorator';
import { MessageLog } from '../entities/messageLog.entity';
import { MessageLogItem } from '../entities/messageLogItem.entity';

import { QueryMessageLogsDto } from './dto/queryMessageLogs.dto';
import { MessageLogsService } from './messageLogs.service';

@ApiTags('message-logs')
@ApiBearerAuth()
@Controller('message-logs')
export class MessageLogsController {
  constructor(private readonly messageLogsService: MessageLogsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List sent reminder messages (paginated, filter by client/type/status/date range/search)',
    description:
      "Each row includes the client (name), not just clientId. search matches the client's first/last name.",
  })
  @ApiResponse({ status: 200, description: 'Returns a page of message logs.' })
  findAll(
    @Query() query: QueryMessageLogsDto,
  ): Promise<PaginatedResult<MessageLog>> {
    return this.messageLogsService.findAll(query);
  }

  @Get(':id/items')
  @ApiOperation({
    summary: 'List the installments covered by a specific sent message',
    description:
      'A message can cover several installments across several loans (consolidated per client) — returns one row per installment included, with its overdueDays/interest snapshot at send time and the related installment/loan.',
  })
  @ApiResponse({ status: 200, description: 'Returns the message log items.' })
  @ApiResponse({ status: 404, description: 'Message log not found.' })
  getItems(@Param('id') id: string): Promise<MessageLogItem[]> {
    return this.messageLogsService.getItems(id);
  }

  @Post(':id/retry')
  @RequireModule(AppModule.Messages)
  @Audit('messageLog.retry', 'messageLogRetry')
  @ApiOperation({
    summary:
      'Manually retry a failed message (admin or granted the messages module)',
    description:
      'Re-sends the message and creates a new, separate log row pointing back at the original via retryOfMessageLogId — the original row is never edited, only stamped with retriedAt.',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns the new message log created by the retry.',
  })
  @ApiResponse({ status: 400, description: 'The message log is not failed.' })
  @ApiResponse({ status: 404, description: 'Message log not found.' })
  retry(@Param('id') id: string): Promise<MessageLog> {
    return this.messageLogsService.retry(id);
  }
}
