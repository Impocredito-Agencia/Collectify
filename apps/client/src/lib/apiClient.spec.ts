import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient, ApiError, setUnauthorizedHandler } from '@/lib/apiClient';
import { tokenStore } from '@/lib/tokenStore';

function jsonResponse(body: unknown, status = 200) {
  return { status, json: () => Promise.resolve(body) };
}

describe('apiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    tokenStore.clear();
    setUnauthorizedHandler(() => {});
  });

  it('returns data and meta when the API responds with the success envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: { status: 'ok' },
          meta: { page: 1 },
        }),
      ),
    );

    const result = await apiClient.get<{ status: string }>('/health');

    expect(result.data).toEqual({ status: 'ok' });
    expect(result.meta).toEqual({ page: 1 });
  });

  it('throws an ApiError when the API responds with the error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { success: false, message: 'Client not found', statusCode: 404 },
            404,
          ),
        ),
    );

    await expect(apiClient.get('/clients/unknown')).rejects.toThrow(ApiError);
  });

  it('returns undefined data for a 204 No Content response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 204,
        json: () => Promise.reject(new Error('should not be called')),
      }),
    );

    const result = await apiClient.post('/auth/change-password', {
      currentPassword: 'a',
      newPassword: 'b',
    });

    expect(result.data).toBeUndefined();
  });

  it('attaches the Authorization header when an access token is set', async () => {
    tokenStore.setAccessToken('the-access-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.get('/clients');

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((requestInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer the-access-token',
    );
  });

  it('refreshes the access token once and retries after a 401', async () => {
    tokenStore.setAccessToken('expired-token');
    tokenStore.setRefreshToken('a-refresh-token');

    let clientsCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse({ success: true, data: { accessToken: 'new-token' } }),
        );
      }
      clientsCallCount += 1;
      if (clientsCallCount === 1) {
        return Promise.resolve(
          jsonResponse(
            { success: false, message: 'Unauthorized', statusCode: 401 },
            401,
          ),
        );
      }
      return Promise.resolve(
        jsonResponse({ success: true, data: { items: [] } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiClient.get<{ items: unknown[] }>('/clients');

    expect(result.data).toEqual({ items: [] });
    expect(tokenStore.getAccessToken()).toBe('new-token');
    expect(fetchMock).toHaveBeenCalledTimes(3); // original (401) + refresh + retry
  });

  it('serializes an array param as repeated query keys', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.get('/whatsapp/conversations', {
      clientIds: ['client-1', 'client-2'],
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(new URL(url).searchParams.getAll('clientIds')).toEqual([
      'client-1',
      'client-2',
    ]);
  });

  it('clears tokens and calls the unauthorized handler when refresh fails', async () => {
    tokenStore.setAccessToken('expired-token');
    tokenStore.setRefreshToken('a-refresh-token');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/refresh')) {
          return Promise.resolve(
            jsonResponse(
              {
                success: false,
                message: 'Invalid refresh token',
                statusCode: 401,
              },
              401,
            ),
          );
        }
        return Promise.resolve(
          jsonResponse(
            { success: false, message: 'Unauthorized', statusCode: 401 },
            401,
          ),
        );
      }),
    );

    await expect(apiClient.get('/clients')).rejects.toThrow(ApiError);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(tokenStore.getAccessToken()).toBeNull();
  });
});
