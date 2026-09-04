import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';

import { User, UserRole } from './entities/user.entity';
import { AppModule } from './entities/userModulePermission.entity';
import { UserModulePermissionsService } from './userModulePermissions.service';
import { UsersService } from './users.service';

jest.mock('bcrypt');

describe('UsersService', () => {
  let service: UsersService;
  let repository: {
    findOneBy: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let userModulePermissionsService: {
    getModulesForUser: jest.Mock;
    getModulesForUsers: jest.Mock;
    setModulesForUser: jest.Mock;
  };

  const mockUser: User = {
    id: 'user-1',
    fullName: 'Test Owner',
    email: 'owner@collectify.com',
    passwordHash: 'stored-hash',
    role: UserRole.Admin,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    repository = {
      findOneBy: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto: Partial<User>) => dto),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    userModulePermissionsService = {
      getModulesForUser: jest.fn().mockResolvedValue([]),
      getModulesForUsers: jest.fn().mockResolvedValue(new Map()),
      setModulesForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
        {
          provide: UserModulePermissionsService,
          useValue: userModulePermissionsService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('findByEmail returns the matching user', async () => {
    repository.findOneBy.mockResolvedValue(mockUser);

    const result = await service.findByEmail(mockUser.email);

    expect(result).toEqual(mockUser);
    expect(repository.findOneBy).toHaveBeenCalledWith({
      email: mockUser.email,
    });
  });

  it('findByEmail returns null when no user matches', async () => {
    repository.findOneBy.mockResolvedValue(null);

    const result = await service.findByEmail('missing@collectify.com');

    expect(result).toBeNull();
  });

  it('findById returns the matching user', async () => {
    repository.findOneBy.mockResolvedValue(mockUser);

    const result = await service.findById(mockUser.id);

    expect(result).toEqual(mockUser);
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: mockUser.id });
  });

  describe('findOne', () => {
    it('returns the matching user as a PublicUser, with its modules', async () => {
      const collector = { ...mockUser, id: 'user-2', role: UserRole.Collector };
      repository.findOneBy.mockResolvedValue(collector);
      userModulePermissionsService.getModulesForUser.mockResolvedValue([
        AppModule.Clients,
      ]);

      const result = await service.findOne('user-2');

      expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'user-2' });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.id).toBe('user-2');
      expect(result.modules).toEqual([AppModule.Clients]);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('selects only active users without the password hash by default', async () => {
      repository.find.mockResolvedValue([mockUser]);

      const result = await service.findAll({});

      expect(result).toEqual([{ ...mockUser, modules: [] }]);
      expect(repository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        select: [
          'id',
          'fullName',
          'email',
          'role',
          'isActive',
          'createdAt',
          'updatedAt',
        ],
        order: { createdAt: 'DESC' },
      });
    });

    it('lists deactivated users when isActive=false is requested', async () => {
      repository.find.mockResolvedValue([]);

      await service.findAll({ isActive: false });

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: false } }),
      );
    });

    it("attaches each collector's granted modules from the batched lookup", async () => {
      const collector = { ...mockUser, id: 'user-2', role: UserRole.Collector };
      repository.find.mockResolvedValue([collector]);
      userModulePermissionsService.getModulesForUsers.mockResolvedValue(
        new Map([['user-2', [AppModule.Clients, AppModule.Loans]]]),
      );

      const result = await service.findAll({});

      expect(
        userModulePermissionsService.getModulesForUsers,
      ).toHaveBeenCalledWith(['user-2']);
      expect(result[0].modules).toEqual([AppModule.Clients, AppModule.Loans]);
    });
  });

  describe('create', () => {
    const createDto = {
      fullName: 'Ana Torres',
      email: 'ana@collectify.com',
      password: 'a-strong-password',
      role: UserRole.Collector,
    };

    beforeEach(() => {
      repository.findOneBy.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      repository.save.mockImplementation((user: Partial<User>) =>
        Promise.resolve({ ...mockUser, ...user, id: 'user-2' }),
      );
    });

    it('creates the user with a hashed password and excludes it from the result', async () => {
      const result = await service.create(createDto);

      expect(bcrypt.hash).toHaveBeenCalledWith('a-strong-password', 10);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: 'Ana Torres',
          email: 'ana@collectify.com',
          passwordHash: 'hashed-password',
          role: UserRole.Collector,
          isActive: true,
        }),
      );
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.email).toBe('ana@collectify.com');
      expect(result.modules).toEqual([]);
    });

    it('rejects a duplicate email', async () => {
      repository.findOneBy.mockResolvedValue(mockUser);

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('sets isActive to false for another user', async () => {
      repository.findOneBy.mockResolvedValue({ ...mockUser });
      repository.save.mockImplementation((user: User) => Promise.resolve(user));

      const result = await service.deactivate('user-2', 'admin-1');

      expect(result.isActive).toBe(false);
    });

    it('rejects deactivating your own account', async () => {
      await expect(service.deactivate('admin-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.findOneBy).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate('missing-id', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reactivate', () => {
    it('sets isActive to true', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });
      repository.save.mockImplementation((user: User) => Promise.resolve(user));

      const result = await service.reactivate('user-2');

      expect(result.isActive).toBe(true);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.reactivate('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('permanently deletes a deactivated user', async () => {
      repository.findOneBy.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await service.remove('user-2');

      expect(repository.delete).toHaveBeenCalledWith({ id: 'user-2' });
    });

    it('rejects deleting an account that is still active', async () => {
      repository.findOneBy.mockResolvedValue({ ...mockUser, isActive: true });

      await expect(service.remove('user-2')).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  it('updatePasswordHash updates the stored hash for the given user', async () => {
    await service.updatePasswordHash(mockUser.id, 'new-hash');

    expect(repository.update).toHaveBeenCalledWith(
      { id: mockUser.id },
      { passwordHash: 'new-hash' },
    );
  });

  describe('setModulePermissions', () => {
    const collector: User = {
      ...mockUser,
      id: 'user-2',
      role: UserRole.Collector,
    };

    it("replaces a collector's granted modules and returns the updated user", async () => {
      repository.findOneBy.mockResolvedValue(collector);
      userModulePermissionsService.getModulesForUser.mockResolvedValue([
        AppModule.Clients,
      ]);

      const result = await service.setModulePermissions('user-2', [
        AppModule.Clients,
      ]);

      expect(
        userModulePermissionsService.setModulesForUser,
      ).toHaveBeenCalledWith('user-2', [AppModule.Clients]);
      expect(result.modules).toEqual([AppModule.Clients]);
    });

    it('rejects setting permissions on an admin account', async () => {
      repository.findOneBy.mockResolvedValue(mockUser);

      await expect(
        service.setModulePermissions(mockUser.id, [AppModule.Clients]),
      ).rejects.toThrow(BadRequestException);
      expect(
        userModulePermissionsService.setModulesForUser,
      ).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.setModulePermissions('missing-id', [AppModule.Clients]),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
