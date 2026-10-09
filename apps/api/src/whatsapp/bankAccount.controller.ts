import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Audit } from '../auditLog/decorators/audit.decorator';
import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { AppModule } from '../users/entities/userModulePermission.entity';

import { BankAccountService, BankAccountSetting } from './bankAccount.service';
import { UpdateBankAccountDto } from './dto/updateBankAccount.dto';

@ApiTags('bank-account')
@ApiBearerAuth()
@Controller('bank-account')
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  // Deliberately open to any authenticated user (no @RequireModule), same
  // reasoning as GET /usury-rates/current: it's read from two screens
  // gated by different modules (the inbox's send preview — messages — and
  // the templates page's editor — message_templates), and the value itself
  // is something the business hands out to every client anyway.
  @Get()
  @ApiOperation({
    summary: 'Get the bank account the cuenta_bancaria template sends',
    description:
      'messagePreview is the full text a client would receive right now. Every field is null until an account is entered for the first time.',
  })
  @ApiResponse({ status: 200, description: 'Returns the current account.' })
  get(): Promise<BankAccountSetting> {
    return this.bankAccountService.get();
  }

  @Put()
  @RequireModule(AppModule.MessageTemplates)
  @Audit('bankAccount.update', 'bankAccount')
  @ApiOperation({
    summary:
      'Set the bank account the cuenta_bancaria template sends (admin or granted the message_templates module)',
    description:
      'Flattened to a single line — Meta rejects a template parameter with line breaks. Takes effect on the very next send.',
  })
  @ApiResponse({ status: 200, description: 'Returns the updated account.' })
  @ApiResponse({ status: 400, description: 'bankAccount missing or blank.' })
  update(@Body() dto: UpdateBankAccountDto): Promise<BankAccountSetting> {
    return this.bankAccountService.update(dto.bankAccount);
  }
}
