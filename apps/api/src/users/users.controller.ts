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
import { CurrentUser } from '../auth/decorators/currentUser.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { CreateUserDto } from './dto/createUser.dto';
import { QueryUsersDto } from './dto/queryUsers.dto';
import { UpdateUserModulePermissionsDto } from './dto/updateUserModulePermissions.dto';
import { UserRole } from './entities/user.entity';
import { UsersService } from './users.service';

import type { AuthenticatedUser } from '../auth/interfaces/authenticatedUser.interface';
import type { PublicUser } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.Admin)
  @ApiOperation({
    summary: 'List users, active by default (admin only)',
    description: 'Pass isActive=false to list deactivated accounts.',
  })
  @ApiResponse({ status: 200, description: 'Returns the list of users.' })
  @ApiResponse({ status: 403, description: 'Requires the admin role.' })
  findAll(@Query() query: QueryUsersDto): Promise<PublicUser[]> {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.Admin)
  @ApiOperation({
    summary: "Get a single user's details (admin only)",
    description:
      'Backs the "Ver perfil" action on the Usuarios list — read-only, no PATCH counterpart exists (edits go through deactivate/reactivate/permissions/delete instead).',
  })
  @ApiResponse({ status: 200, description: 'Returns the user.' })
  @ApiResponse({ status: 403, description: 'Requires the admin role.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  findOne(@Param('id') id: string): Promise<PublicUser> {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.Admin)
  @Audit('user.create', 'user')
  @ApiOperation({
    summary: 'Create a collector or admin account (admin only)',
    description: 'No self-registration — accounts are always admin-created.',
  })
  @ApiResponse({ status: 201, description: 'The user was created.' })
  @ApiResponse({ status: 409, description: 'Email already in use.' })
  create(@Body() dto: CreateUserDto): Promise<PublicUser> {
    return this.usersService.create(dto);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.Admin)
  @Audit('user.deactivate', 'user')
  @ApiOperation({
    summary: 'Deactivate a user account (admin only)',
    description:
      'Locks the account out of login without deleting it. An admin cannot deactivate their own account.',
  })
  @ApiResponse({ status: 200, description: 'The user was deactivated.' })
  @ApiResponse({
    status: 400,
    description: 'Cannot deactivate your own account.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  deactivate(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<PublicUser> {
    return this.usersService.deactivate(id, currentUser.id);
  }

  @Patch(':id/reactivate')
  @Roles(UserRole.Admin)
  @Audit('user.reactivate', 'user')
  @ApiOperation({
    summary: 'Reactivate a deactivated user account (admin only)',
  })
  @ApiResponse({ status: 200, description: 'The user was reactivated.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  reactivate(@Param('id') id: string): Promise<PublicUser> {
    return this.usersService.reactivate(id);
  }

  @Delete(':id')
  @Roles(UserRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit('user.delete', 'user')
  @ApiOperation({
    summary: 'Permanently delete a deactivated user account (admin only)',
    description:
      'Irreversible — a real delete, not the deactivate/reactivate soft lock above. Only allowed once the account is already deactivated. Past actions this user took stay in the audit trail and usury-rate history (actor/creator reference set to null, per docs/phases/PHASE_20_MODULE_PERMISSIONS.md), only the account itself is removed.',
  })
  @ApiResponse({ status: 204, description: 'The user was deleted.' })
  @ApiResponse({
    status: 400,
    description: 'The account is still active — deactivate it first.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  @Put(':id/permissions')
  @Roles(UserRole.Admin)
  @Audit('user.updatePermissions', 'user')
  @ApiOperation({
    summary: "Replace a collector's module permissions (admin only)",
    description:
      "Sets the full set of modules this collector can access, replacing whatever was granted before. Rejected for an admin account — an admin's access is unconditional and never depends on these rows. See docs/phases/PHASE_20_MODULE_PERMISSIONS.md.",
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the user with its updated modules.',
  })
  @ApiResponse({
    status: 400,
    description: 'The target account is an admin, not a collector.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  setModulePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateUserModulePermissionsDto,
  ): Promise<PublicUser> {
    return this.usersService.setModulePermissions(id, dto.modules);
  }
}
