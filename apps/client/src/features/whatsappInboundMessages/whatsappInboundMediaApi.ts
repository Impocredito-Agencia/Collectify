/**
 * GET /whatsapp/inbound-messages/:id/media doesn't fit apiClient.ts's
 * shape: it returns raw media bytes with a real Content-Type, not the
 * {success, data} JSON envelope (WhatsappController uses @Res() to bypass
 * it entirely — see that controller's comment). Same reasoning as
 * clientsImportApi.ts's own file downloads — talks to the API directly
 * with fetch, reusing tokenStore the same way apiClient.ts does.
 *
 * Human report, 2026-09-14 — backs audio/video playback in the inbox. The
 * file is never re-hosted to Cloudinary or persisted anywhere else (the
 * client doesn't want that quota spent on a voice note/video, just the
 * ability to review it) — this fetches it fresh from Meta on every call.
 * A plain <audio src>/<video src> can't carry the Bearer auth header this
 * endpoint requires, so the caller fetches it as a blob and plays that via
 * URL.createObjectURL instead — see InboundMediaPlayer on
 * WhatsappInboundMessagesPage.tsx.
 */

import { ApiError } from '@/lib/apiClient';
import { tokenStore } from '@/lib/tokenStore';

const API_URL = import.meta.env.VITE_API_URL;

export const whatsappInboundMediaApi = {
  getMediaBlob: async (messageId: string): Promise<Blob> => {
    const accessToken = tokenStore.getAccessToken();
    const response = await fetch(
      `${API_URL}/whatsapp/inbound-messages/${messageId}/media`,
      {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      },
    );
    if (!response.ok) {
      throw new ApiError(
        'No se pudo cargar el archivo — puede que ya no esté disponible en WhatsApp.',
        response.status,
      );
    }
    return response.blob();
  },
};
