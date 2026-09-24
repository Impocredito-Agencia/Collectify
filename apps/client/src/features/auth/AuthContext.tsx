import { useCallback, useEffect, useState } from 'react';

import { authApi } from '@/features/auth/authApi';
import { AuthContext } from '@/features/auth/authContext';
import { setUnauthorizedHandler } from '@/lib/apiClient';
import { tokenStore } from '@/lib/tokenStore';
import { clearSessionState } from '@/lib/useSessionState';

import type { AuthenticatedUser, LoginInput } from '@/features/auth/authApi';
import type { ReactNode } from 'react';

// The context object and its value type live in authContext.ts — keeping
// this file's exports to just the AuthProvider component is what Vite's
// Fast Refresh needs (react-refresh/only-export-components).
interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const logout = useCallback(() => {
    tokenStore.clear();
    clearSessionState();
    setUser(null);
  }, []);

  // Wire apiClient's 401-after-failed-refresh path to this provider's own
  // logout, so an expired session anywhere in the app lands the user back
  // on /login instead of failing silently.
  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  // On mount: if a refresh token survived from a previous session
  // (localStorage), exchange it for a fresh access token and load the
  // current user before rendering any protected route.
  useEffect(() => {
    async function bootstrap() {
      const refreshToken = tokenStore.getRefreshToken();
      if (!refreshToken) {
        setIsBootstrapping(false);
        return;
      }

      try {
        const { accessToken } = await authApi.refresh(refreshToken);
        tokenStore.setAccessToken(accessToken);
        const currentUser = await authApi.me();
        setUser(currentUser);
      } catch {
        tokenStore.clear();
      } finally {
        setIsBootstrapping(false);
      }
    }

    void bootstrap();
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const tokens = await authApi.login(input);
    tokenStore.setAccessToken(tokens.accessToken);
    tokenStore.setRefreshToken(tokens.refreshToken);
    const currentUser = await authApi.me();
    setUser(currentUser);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: user !== null,
        isBootstrapping,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
