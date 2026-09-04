import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Audit } from '../auditLog/decorators/audit.decorator';
import { CurrentUser } from '../auth/decorators/currentUser.decorator';
import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { AppModule } from '../users/entities/userModulePermission.entity';

import { CreateUsuryRateDto } from './dto/createUsuryRate.dto';
import { UsuryRate } from './entities/usuryRate.entity';
import { CurrentUsuryRate, UsuryRateService } from './usuryRates.service';

import type { AuthenticatedUser } from '../auth/interfaces/authenticatedUser.interface';

@ApiTags('usury-rates')
@ApiBearerAuth()
@Controller('usury-rates')
export class UsuryRatesController {
  constructor(private readonly usuryRateService: UsuryRateService) {}

  // Deliberately open to any authenticated user (no @Roles/@RequireModule)
  // as of Phase 24 — since a collector granted the loans module can create
  // a loan (Phase 23) and that now hard-blocks without a current rate on
  // file, they need to see this before hitting a raw 400 on submit. Same
  // reasoning as GET /interest-concept-types. Managing the rate (POST, and
  // the full history below) requires the usury_rates module (Phase 20) —
  // see docs/phases/PHASE_24_USURY_MANDATORY.md.
  @Get('current')
  @ApiOperation({
    summary: 'Get the current usury ceiling',
    description:
      "isStale is true when nobody has entered this calendar month's certified rate yet — not tied to a fixed publication day, since the SFC's own publication date moves around. As of Phase 24, a stale or missing rate hard-blocks loan creation — see docs/phases/PHASE_24_USURY_MANDATORY.md.",
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the latest rate on file, or null if none exists yet.',
  })
  getCurrentRate(): Promise<CurrentUsuryRate | null> {
    return this.usuryRateService.getCurrentRate();
  }

  @Get()
  @RequireModule(AppModule.UsuryRates)
  @ApiOperation({
    summary:
      'List the full usury rate history, most recent month first (admin or granted the usury_rates module)',
  })
  @ApiResponse({ status: 200, description: 'Returns the rate history.' })
  findAll(): Promise<UsuryRate[]> {
    return this.usuryRateService.findAll();
  }

  @Post()
  @RequireModule(AppModule.UsuryRates)
  @Audit('usuryRate.create', 'usuryRate')
  @ApiOperation({
    summary:
      "Record a new month's certified usury rate (admin or granted the usury_rates module)",
    description:
      "Always creates a new historical row — never mutates a previous month's rate. Rejects a duplicate month.",
  })
  @ApiResponse({ status: 201, description: 'The rate was recorded.' })
  @ApiResponse({
    status: 409,
    description: 'A rate for that month already exists.',
  })
  setRate(
    @Body() dto: CreateUsuryRateDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UsuryRate> {
    return this.usuryRateService.setRate(dto, currentUser.id);
  }
}
