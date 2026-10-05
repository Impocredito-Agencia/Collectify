import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/lib/apiClient';

import { ImageUploadError, uploadPaymentReceipt } from './imageUpload';

const signature = {
  signature: 'sig',
  timestamp: 1790000000,
  apiKey: 'key',
  cloudName: 'demo',
  folder: 'payment-receipts',
};

describe('uploadPaymentReceipt', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: signature });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uploads a PDF comprobante and returns its hosted URL', async () => {
    const pdfUrl =
      'https://res.cloudinary.com/demo/image/upload/v1/payment-receipts/a.pdf';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ secure_url: pdfUrl }),
    });
    const pdf = new File(['%PDF'], 'transferencia.pdf', {
      type: 'application/pdf',
    });

    await expect(uploadPaymentReceipt(pdf)).resolves.toBe(pdfUrl);

    // `auto`, not `image` — Cloudinary's image-only endpoint is not what a
    // comprobante that may be a PDF goes through.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudinary.com/v1_1/demo/auto/upload',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('file')).toBe(pdf);
    expect(body.get('folder')).toBe('payment-receipts');
  });

  it('still uploads a photo comprobante', async () => {
    const photoUrl =
      'https://res.cloudinary.com/demo/image/upload/v1/payment-receipts/a.jpg';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ secure_url: photoUrl }),
    });

    await expect(
      uploadPaymentReceipt(new File(['a'], 'a.jpg', { type: 'image/jpeg' })),
    ).resolves.toBe(photoUrl);
  });

  it('rejects a file that is neither a photo nor a PDF without uploading anything', async () => {
    const spreadsheet = new File(['x'], 'pagos.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await expect(uploadPaymentReceipt(spreadsheet)).rejects.toBeInstanceOf(
      ImageUploadError,
    );
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a failed upload as an ImageUploadError', async () => {
    fetchMock.mockResolvedValue({ ok: false });

    await expect(
      uploadPaymentReceipt(
        new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }),
      ),
    ).rejects.toThrow('No se pudo subir el comprobante. Intenta de nuevo.');
  });
});
