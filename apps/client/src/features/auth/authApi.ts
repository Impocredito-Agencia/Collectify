import { apiClient } from '@/lib/apiClient';

// Matches apps/api/src/users/entities/user.entity.ts UserRole enum.
export type UserRole = 'admin' | 'collector';

// Matches apps/api/src/users/entities/userModulePermission.entity.ts
// AppModule enum — the sidebar's top-level menu items, confirmed with the
// human for Phase 20. Dashboard and Perfil are deliberately excluded: never
// restricted. See docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
export type AppModule =
  | 'clients'
  | 'loans'
  | 'messages'
  | 'message_templates'
  | 'interest_concept_types'
  | 'audit_log'
  | 'usury_rates'
  | 'users';

// Style cleanup (2026-09-01): 'messages' and 'interest_concept_types' labels
// updated to match Sidebar.tsx's renamed nav items ("Envíos fallidos" and
// "Tipos de cargo") so the permissions-management UI (Usuarios) describes
// each module the same way the sidebar does.
export const MODULE_LABELS: Record<AppModule, string> = {
  clients: 'Clientes',
  loans: 'Préstamos',
  messages: 'Envíos fallidos',
  message_templates: 'Plantillas',
  interest_concept_types: 'Tipos de cargo',
  audit_log: 'Auditoría',
  usury_rates: 'Tasa de usura',
  users: 'Usuarios',
};

// Matches apps/api/src/auth/interfaces/authenticatedUser.interface.ts.
// fullName/createdAt added for the "Mi perfil" screen (client request,
// post-Phase-5) — both already existed on the User entity, GET /auth/me
// just didn't surface them yet. See apps/client/docs/DESIGN_TOKENS.md
// "Known design/backend gaps".
//
// modules added Phase 20 — always [] for an admin, who has full access
// unconditionally regardless of this field (mirrors the backend's
// AuthenticatedUser exactly — see ModulePermissionsGuard). Used by
// RequirePermission.tsx and Sidebar.tsx's nav-item visibility.
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  createdAt: string;
  modules: AppModule[];
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export const authApi = {
  login: async (input: LoginInput): Promise<AuthTokens> => {
    const { data } = await apiClient.post<AuthTokens>('/auth/login', input);
    return data;
  },

  refresh: async (
    refreshToken: string,
  ): Promise<Pick<AuthTokens, 'accessToken'>> => {
    const { data } = await apiClient.post<Pick<AuthTokens, 'accessToken'>>(
      '/auth/refresh',
      { refreshToken },
    );
    return data;
  },

  me: async (): Promise<AuthenticatedUser> => {
    const { data } = await apiClient.get<AuthenticatedUser>('/auth/me');
    return data;
  },

  changePassword: async (input: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void> => {
    await apiClient.post('/auth/change-password', input);
  },
};
