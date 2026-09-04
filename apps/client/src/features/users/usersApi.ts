import { apiClient } from '@/lib/apiClient';

import type { AppModule, UserRole } from '@/features/auth/authApi';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  collector: 'Cobrador',
};

// Matches apps/api/src/users/users.service.ts's PublicUser (User minus
// passwordHash) — the API never returns a password hash to the client.
// modules added Phase 20 — always [] for an admin, who has full access
// unconditionally regardless of this field. See
// docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  modules: AppModule[];
}

export interface UsersQueryParams {
  // true (default) for active users, false for deactivated ones — same
  // convention as ClientsQueryParams/InterestConceptTypesQueryParams. No
  // search/pagination: QueryUsersDto only supports isActive, and a company
  // user list is expected to stay small.
  isActive?: boolean;
}

export interface CreateUserInput {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
}

export const usersApi = {
  // Admin only — enforced server-side via @Roles(UserRole.Admin).
  getAll: async (params: UsersQueryParams = {}): Promise<User[]> => {
    const { data } = await apiClient.get<User[]>('/users', {
      isActive: params.isActive,
    });
    return data;
  },

  // Backs the "Ver perfil" action on the Usuarios list (UserDetailPage) —
  // read-only, admin only, same as getAll. No PATCH counterpart exists on
  // the backend; edits go through deactivate/reactivate/permissions/delete
  // instead.
  getById: async (id: string): Promise<User> => {
    const { data } = await apiClient.get<User>(`/users/${id}`);
    return data;
  },

  create: async (input: CreateUserInput): Promise<User> => {
    const { data } = await apiClient.post<User>('/users', input);
    return data;
  },

  // Locks the account out of login without deleting it — an admin cannot
  // deactivate their own account (enforced server-side).
  deactivate: async (id: string): Promise<User> => {
    const { data } = await apiClient.patch<User>(`/users/${id}/deactivate`);
    return data;
  },

  reactivate: async (id: string): Promise<User> => {
    const { data } = await apiClient.patch<User>(`/users/${id}/reactivate`);
    return data;
  },

  // Permanent, irreversible deletion — different from deactivate above.
  // Only allowed for an already-deactivated account (enforced
  // server-side, see UsersService.remove).
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/users/${id}`);
  },

  // Replaces the full set of granted modules — rejected server-side for an
  // admin account (see UsersService.setModulePermissions), so this is only
  // ever called for a collector.
  updatePermissions: async (
    id: string,
    modules: AppModule[],
  ): Promise<User> => {
    const { data } = await apiClient.put<User>(`/users/${id}/permissions`, {
      modules,
    });
    return data;
  },
};
