/**
 * Base fetch wrapper for talking to the API. Parses the two response shapes
 * documented in docs/ARCHITECTURE.md:
 *   success: { success: true, data, meta? }
 *   error:   { success: false, message, statusCode }
 *
 * Convention: apiClient returns the full envelope ({ data, meta }) since
 * `meta` matters for paginated list endpoints. A feature's own `*Api.ts`
 * decides whether to expose `meta` (list endpoints) or unwrap straight to
 * `.data` (single-resource endpoints) — see features/health/healthApi.ts
 * for the unwrapped pattern.
 *
 * Auth (Phase 2): attaches the access token from tokenStore as a Bearer
 * header on every request, and — for any request other than login itself —
 * transparently refreshes an expired access token once on a 401 and retries
 * the original request before giving up. If the refresh also fails, the
 * registered "unauthorized" handler runs (features/auth/AuthContext.tsx
 * wires this to its own logout()), and the original call still rejects with
 * an ApiError so the caller's error handling (e.g. a query's `isError`)
 * behaves normally either way.
 */

import { tokenStore } from '@/lib/tokenStore';

const API_URL = import.meta.env.VITE_API_URL;

interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

interface ApiErrorResponse {
  success: false;
  message: string;
  statusCode: number;
}

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface ApiResult<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  params?: Record<string, string | number | boolean | string[] | undefined>;
}

// Set once by AuthProvider on mount. A plain callback (rather than importing
// features/auth here) keeps lib/ from depending on features/ — see
// docs/ARCHITECTURE.md.
let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const url = new URL(`${API_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      // Repeated keys (?key=a&key=b) — matches Nest/Express's default
      // array query parsing, e.g. QueryWhatsappConversationsDto's
      // clientIds.
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item);
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const payload = (await response.json()) as ApiResponse<{
      accessToken: string;
    }>;

    if (!payload.success) {
      return null;
    }

    tokenStore.setAccessToken(payload.data.accessToken);
    return payload.data.accessToken;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<ApiResult<T>> {
  const { method = 'GET', body, params } = options;
  const accessToken = tokenStore.getAccessToken();

  const response = await fetch(buildUrl(path, params), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && !isRetry && path !== '/auth/login') {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      return request<T>(path, options, true);
    }
    tokenStore.clear();
    onUnauthorized();
  }

  // e.g. POST /auth/change-password returns 204 with no body.
  if (response.status === 204) {
    return { data: undefined as T };
  }

  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.success) {
    throw new ApiError(payload.message, payload.statusCode);
  }

  return { data: payload.data, meta: payload.meta };
}

export const apiClient = {
  get: <T>(path: string, params?: RequestOptions['params']) =>
    request<T>(path, { method: 'GET', params }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
