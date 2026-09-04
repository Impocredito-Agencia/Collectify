import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { CreateUserDto } from './dto/createUser.dto';
import { QueryUsersDto } from './dto/queryUsers.dto';
import { User, UserRole } from './entities/user.entity';
import { AppModule } from './entities/userModulePermission.entity';
import { UserModulePermissionsService } from './userModulePermissions.service';

const BCRYPT_SALT_ROUNDS = 10;
const POSTGRES_UNIQUE_VIOLATION = '23505';
const PUBLIC_USER_FIELDS = [
  'id',
  'fullName',
  'email',
  'role',
  'isActive',
  'createdAt',
  'updatedAt',
] as const;

// modules added Phase 20 — always [] for an admin (see
// UserModulePermission's doc comment); for a collector, the modules
// they've been explicitly granted. See
// docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
export type PublicUser = Omit<User, 'passwordHash'> & { modules: AppModule[] };

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly userModulePermissionsService: UserModulePermissionsService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  // Public-facing counterpart to findById above — throws instead of
  // returning null (the controller has nothing sensible to do with a null
  // here) and shapes the result as PublicUser (no passwordHash, real
  // `modules`), same as every other read/write method below. Added so
  // Usuarios can offer a "Ver perfil" action per row (previously there was
  // no GET /users/:id at all — see UserRow.tsx's old comment about that).
  async findOne(id: string): Promise<PublicUser> {
    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return this.toPublicUser(user);
  }

  async findAll(query: QueryUsersDto): Promise<PublicUser[]> {
    const isActive = query.isActive ?? true;

    const users = await this.usersRepository.find({
      where: { isActive },
      select: [...PUBLIC_USER_FIELDS],
      order: { createdAt: 'DESC' },
    });

    const modulesByUserId =
      await this.userModulePermissionsService.getModulesForUsers(
        users.map((user) => user.id),
      );

    return users.map((user) => ({
      ...user,
      modules: modulesByUserId.get(user.id) ?? [],
    }));
  }

  // Per docs/PROJECT_ROADMAP.md Phase 8 — the human confirmed self-registration
  // stays out of scope; only an admin creates collector/admin accounts here.
  async create(dto: CreateUserDto): Promise<PublicUser> {
    await this.assertEmailIsUnique(dto.email);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    const user = this.usersRepository.create({
      fullName: dto.fullName,
      email: dto.email,
      passwordHash,
      role: dto.role,
      isActive: true,
    });

    let saved: User;
    try {
      saved = await this.usersRepository.save(user);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }

    return await this.toPublicUser(saved);
  }

  // Deactivating locks the account out of login (see AuthService.login),
  // without deleting it — history (e.g. who sent which reminder) stays intact.
  async deactivate(id: string, currentUserId: string): Promise<PublicUser> {
    if (id === currentUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    return this.setActive(id, false);
  }

  async reactivate(id: string): Promise<PublicUser> {
    return this.setActive(id, true);
  }

  // Permanent, irreversible removal — deliberately different from
  // deactivate/reactivate above, which only ever flip isActive and keep
  // the row (and its history) intact. Only allowed once an account has
  // already been deactivated — confirmed with the human (Phase 20
  // follow-up): this is a second, explicit step after deactivation, not a
  // shortcut around it, so an admin can't delete someone who's still able
  // to log in. A real SQL DELETE, not TypeORM's soft-delete — even though
  // User has a deletedAt column, the human explicitly chose permanent
  // deletion here. Safe to hard-delete: audit_logs.actorUserId and
  // usury_rates.createdBy both use onDelete: 'SET NULL', so this account's
  // past actions stay in those trails with no resolvable actor instead of
  // being deleted along with it. user_module_permissions rows cascade-
  // delete, which is fine — they're just this account's own grants.
  async remove(id: string): Promise<void> {
    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    if (user.isActive) {
      throw new BadRequestException(
        'The account must be deactivated before it can be deleted',
      );
    }

    await this.usersRepository.delete({ id });
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.usersRepository.update({ id }, { passwordHash });
  }

  // Rejects for an admin account rather than silently accepting and
  // discarding — an admin's module permissions are never consulted (see
  // UserModulePermission's doc comment), so setting them would be
  // misleading about what actually controls that account's access.
  async setModulePermissions(
    id: string,
    modules: AppModule[],
  ): Promise<PublicUser> {
    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    if (user.role === UserRole.Admin) {
      throw new BadRequestException(
        'An admin account always has full access — module permissions only apply to collector accounts',
      );
    }

    await this.userModulePermissionsService.setModulesForUser(id, modules);
    return this.toPublicUser(user);
  }

  private async setActive(id: string, isActive: boolean): Promise<PublicUser> {
    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    user.isActive = isActive;
    const saved = await this.usersRepository.save(user);
    return await this.toPublicUser(saved);
  }

  // A freshly created user has no rows yet (an empty array is exactly
  // right); deactivate/reactivate don't touch the rows at all, so this
  // still needs a real fetch to report a deactivated collector's modules
  // accurately.
  private async toPublicUser(user: User): Promise<PublicUser> {
    const modules =
      user.role === UserRole.Admin
        ? []
        : await this.userModulePermissionsService.getModulesForUser(user.id);

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
      modules,
    };
  }

  private async assertEmailIsUnique(email: string): Promise<void> {
    const existing = await this.usersRepository.findOneBy({ email });
    if (existing) {
      throw new ConflictException(`A user with email ${email} already exists`);
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === POSTGRES_UNIQUE_VIOLATION
    ) {
      return new ConflictException('A user with this email already exists');
    }
    return error;
  }
}
