import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { usersApi } from '@/features/users/usersApi';

import type { AppModule } from '@/features/auth/authApi';
import type { UsersQueryParams } from '@/features/users/usersApi';

export function useUsers(params: UsersQueryParams = {}) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () => usersApi.getAll(params),
  });
}

// Mirrors useClients.ts's useClient(id) — feeds UserDetailPage's "Ver
// perfil" view.
export function useUser(id: string) {
  return useQuery({
    queryKey: ['users', id],
    queryFn: () => usersApi.getById(id),
    enabled: Boolean(id),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: usersApi.deactivate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useReactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: usersApi.reactivate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: usersApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUserPermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, modules }: { id: string; modules: AppModule[] }) =>
      usersApi.updatePermissions(id, modules),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}
