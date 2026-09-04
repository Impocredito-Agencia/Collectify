import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Audit } from '../auditLog/decorators/audit.decorator';
import { RequireModule } from '../auth/decorators/requireModule.decorator';
import { PaginatedResult } from '../common/interfaces/paginatedResult.interface';
import { AppModule } from '../users/entities/userModulePermission.entity';

import { ClientDetail, ClientsService } from './clients.service';
import { CreateClientDto } from './dto/createClient.dto';
import { CreateClientReferenceDto } from './dto/createClientReference.dto';
import { QueryClientsDto } from './dto/queryClients.dto';
import { SetClientMessageFrequencyDto } from './dto/setClientMessageFrequency.dto';
import { UpdateClientDto } from './dto/updateClient.dto';
import { UpdateClientReferenceDto } from './dto/updateClientReference.dto';
import { Client } from './entities/client.entity';
import { ClientMessageFrequency } from './entities/clientMessageFrequency.entity';
import { ClientReference } from './entities/clientReference.entity';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @ApiOperation({ summary: 'List clients (paginated, searchable, filterable)' })
  @ApiResponse({ status: 200, description: 'Returns a page of clients.' })
  findAll(@Query() query: QueryClientsDto): Promise<PaginatedResult<Client>> {
    return this.clientsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a client by id' })
  @ApiResponse({
    status: 200,
    description:
      'Returns the client, including creditUsed, creditAvailable, ' +
      'isMoraBlocked, and references — the first three computed on read, ' +
      'not stored columns; references from the client_references table. ' +
      'See docs/phases/PHASE_10_CLIENT_CAPACITY.md and ' +
      'docs/phases/PHASE_21_CLIENT_PROFILE.md.',
  })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  findOne(@Param('id') id: string): Promise<ClientDetail> {
    return this.clientsService.findOneDetail(id);
  }

  @Post()
  @RequireModule(AppModule.Clients)
  @Audit('client.create', 'client')
  @ApiOperation({
    summary: 'Create a client (admin or granted the clients module)',
    description:
      'dataProcessingConsent must be true — the client must have signed the data-processing ' +
      'authorization before being saved. documentNumber is required (CreateClientDto), and at ' +
      'least one of homeAddress/workAddress must be provided — both enforced unconditionally, ' +
      'including for bulk-imported clients. See docs/phases/PHASE_21_CLIENT_PROFILE.md and ' +
      'docs/phases/PHASE_26_CODEBTOR_CLIENT.md.',
  })
  @ApiResponse({ status: 201, description: 'The client was created.' })
  @ApiResponse({
    status: 400,
    description:
      'Missing data-processing consent, missing document type, or no address ' +
      '(homeAddress/workAddress both empty).',
  })
  @ApiResponse({ status: 409, description: 'Document number already in use.' })
  create(@Body() dto: CreateClientDto): Promise<Client> {
    return this.clientsService.create(dto);
  }

  @Patch(':id')
  @RequireModule(AppModule.Clients)
  @Audit('client.update', 'client')
  @ApiOperation({
    summary: 'Update a client (admin or granted the clients module)',
  })
  @ApiResponse({ status: 200, description: 'The client was updated.' })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  @ApiResponse({ status: 409, description: 'Document number already in use.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ): Promise<Client> {
    return this.clientsService.update(id, dto);
  }

  @Patch(':id/reactivate')
  @RequireModule(AppModule.Clients)
  @Audit('client.reactivate', 'client')
  @ApiOperation({
    summary:
      'Restore a soft-deleted client (admin or granted the clients module)',
  })
  @ApiResponse({ status: 200, description: 'The client was reactivated.' })
  @ApiResponse({ status: 400, description: 'The client is already active.' })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  reactivate(@Param('id') id: string): Promise<Client> {
    return this.clientsService.reactivate(id);
  }

  @Post(':id/references')
  @RequireModule(AppModule.Clients)
  @Audit('client.addReference', 'client')
  @ApiOperation({
    summary:
      'Add a personal or comercial reference to a client (admin or granted the clients module)',
  })
  @ApiResponse({ status: 201, description: 'The reference was added.' })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  addReference(
    @Param('id') id: string,
    @Body() dto: CreateClientReferenceDto,
  ): Promise<ClientReference> {
    return this.clientsService.addReference(id, dto);
  }

  @Patch(':id/references/:referenceId')
  @RequireModule(AppModule.Clients)
  @Audit('client.updateReference', 'client')
  @ApiOperation({
    summary:
      "Edit one of a client's references (admin or granted the clients module)",
  })
  @ApiResponse({ status: 200, description: 'The reference was updated.' })
  @ApiResponse({ status: 404, description: 'Client or reference not found.' })
  updateReference(
    @Param('id') id: string,
    @Param('referenceId') referenceId: string,
    @Body() dto: UpdateClientReferenceDto,
  ): Promise<ClientReference> {
    return this.clientsService.updateReference(id, referenceId, dto);
  }

  @Delete(':id/references/:referenceId')
  @RequireModule(AppModule.Clients)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit('client.removeReference', 'client')
  @ApiOperation({
    summary:
      "Remove one of a client's references (admin or granted the clients module)",
  })
  @ApiResponse({ status: 204, description: 'The reference was removed.' })
  @ApiResponse({ status: 404, description: 'Client or reference not found.' })
  removeReference(
    @Param('id') id: string,
    @Param('referenceId') referenceId: string,
  ): Promise<void> {
    return this.clientsService.removeReference(id, referenceId);
  }

  // --- Message frequency whitelist (Phase 27) — replaces the overdue/
  // upcoming_due curated audience: throttles how often those two reminder
  // types reach this client, never whether they're eligible. See
  // docs/phases/PHASE_27_MESSAGE_FREQUENCY.md. ---

  @Get(':id/message-frequency')
  @RequireModule(AppModule.Clients)
  @ApiOperation({
    summary:
      "View a client's message frequency override (admin or granted the clients module)",
    description:
      'Returns the whitelist entry throttling overdue/upcoming_due reminders for this ' +
      'client, or null if none is set (meaning the client is never throttled).',
  })
  @ApiResponse({
    status: 200,
    description: "Returns the client's message frequency entry, or null.",
  })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  async getMessageFrequency(
    @Param('id') id: string,
  ): Promise<ClientMessageFrequency | null> {
    await this.clientsService.findOne(id);
    return this.clientsService.getMessageFrequency(id);
  }

  @Put(':id/message-frequency')
  @RequireModule(AppModule.Clients)
  @Audit('client.setMessageFrequency', 'client')
  @ApiOperation({
    summary:
      "Set a client's message frequency override (admin or granted the clients module)",
    description:
      'Creates or updates the minimum number of days between overdue/upcoming_due ' +
      'reminders for this client. Does not affect eligibility — only how often an ' +
      'already-qualifying client is messaged.',
  })
  @ApiResponse({ status: 200, description: 'The frequency entry was saved.' })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  setMessageFrequency(
    @Param('id') id: string,
    @Body() dto: SetClientMessageFrequencyDto,
  ): Promise<ClientMessageFrequency> {
    return this.clientsService.setMessageFrequency(id, dto);
  }

  @Delete(':id/message-frequency')
  @RequireModule(AppModule.Clients)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit('client.clearMessageFrequency', 'client')
  @ApiOperation({
    summary:
      "Clear a client's message frequency override (admin or granted the clients module)",
    description:
      'Removes the whitelist entry — the client goes back to being messaged on every ' +
      'qualifying cron run, same as a client who was never on the whitelist.',
  })
  @ApiResponse({ status: 204, description: 'The frequency entry was removed.' })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  clearMessageFrequency(@Param('id') id: string): Promise<void> {
    return this.clientsService.clearMessageFrequency(id);
  }

  @Delete(':id')
  @RequireModule(AppModule.Clients)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit('client.deactivate', 'client')
  @ApiOperation({
    summary: 'Soft-delete a client (admin or granted the clients module)',
  })
  @ApiResponse({ status: 204, description: 'The client was deleted.' })
  @ApiResponse({ status: 404, description: 'Client not found.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.clientsService.softDelete(id);
  }
}
