import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import { AppModule } from '../users/entities/userModulePermission.entity';

import { AuditLogService } from './auditLog.service';
import { QueryAuditLogDto } from './dto/queryAuditLog.dto';
import { AuditLog } from './entities/auditLog.entity';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequireModule(AppModule.AuditLog)
  @ApiOperation({
    summary:
      'List audit log entries (paginated, filterable, admin or granted the audit_log module)',
    description:
      'Filters: search (free text — client name/cédula/phone or pagaré ' +
      "number; also finds the entries of that client's or pagaré's loans, " +
      'installments and payments), actorUserId, action (exact match, e.g. ' +
      '"client.create"), entityType (exact match), dateFrom/dateTo ' +
      '(createdAt range). ' +
      'Ordered newest first. Each entry includes the actor user (name/email), ' +
      'not just their id.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns a page of audit log entries.',
  })
  @ApiResponse({
    status: 403,
    description: 'Requires the admin role or the audit_log module.',
  })
  findAll(
    @Query() query: QueryAuditLogDto,
  ): Promise<PaginatedResult<AuditLog>> {
    return this.auditLogService.findAll(query);
  }

  @Get('actors')
  @RequireModule(AppModule.AuditLog)
  @ApiOperation({
    summary:
      'List the users who appear in the audit trail (for the actor filter, admin or granted the audit_log module)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Returns { id, fullName } for every user with at least one entry.',
  })
  @ApiResponse({
    status: 403,
    description: 'Requires the admin role or the audit_log module.',
  })
  findActors(): Promise<{ id: string; fullName: string }[]> {
    return this.auditLogService.findActors();
  }
}
