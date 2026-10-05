/**
 * Thin wrapper around Cloudinary's signed upload endpoint, per
 * docs/phases/PHASE_12_PAYMENT_ATTACHMENTS.md's provider recommendation.
 * The api never touches image bytes (see CreatePaymentDto.imageUrls) — the
 * client uploads directly to Cloudinary from the browser and only sends
 * the resulting URL to our own api. This keeps apps/api free of
 * file-handling code and storage costs, per that doc's explicit scope
 * decision.
 *
 * Uses a *signed* upload rather than the original unsigned-preset design:
 * an unsigned preset's cloud name/preset name ship in the client bundle,
 * so anyone who copies them out of devtools can POST uploads straight to
 * the Cloudinary account without ever logging into Collectify (quota/cost
 * abuse risk). A signed upload ties every upload to an authenticated
 * session instead — the api's POST /uploads/cloudinary-signature (see
 * apps/api/src/uploads) signs a short-lived payload with the Cloudinary
 * api secret, which never leaves the backend. Image bytes still never
 * pass through the api — only the small signature payload does.
 *
 * Phase 21 widens this to also accept PDFs (client ID documents / the
 * consent evidence document may be uploaded as a single combined PDF
 * instead of two photos — see docs/phases/PHASE_21_CLIENT_PROFILE.md
 * "Uploads"). Cloudinary's `/image/upload` endpoint only accepts raster
 * images; PDFs need `resource_type: 'auto'` against the generic `/auto/
 * upload` endpoint instead, which detects image vs. raw automatically.
 *
 * The payment-receipt path was image-only until 2026-10-05 (human report —
 * a comprobante is often a PDF the bank generates, not a photo). It now
 * goes through `auto` too, but still fails fast on anything that isn't an
 * image or a PDF (see uploadPaymentReceipt) instead of silently uploading
 * it as a raw resource.
 */

import { apiClient, ApiError } from '@/lib/apiClient';

// Mirrors apps/api/src/uploads/dto/generateCloudinarySignature.dto.ts's
// CloudinaryUploadFolder enum — kept as a plain string union here since
// apps/client can't import from apps/api (separate deployed apps).
type CloudinaryUploadFolder = 'payment-receipts' | 'client-documents';

interface CloudinarySignature {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: CloudinaryUploadFolder;
}

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

// Shared by both upload paths below: asks the api to sign the upload,
// then posts the file straight to Cloudinary and unwraps secure_url.
// `resourceType` picks the Cloudinary endpoint (`image` vs `auto`); the
// error messages stay generic ("la foto"/"el archivo") via the caller's
// own wording, not duplicated here.
async function uploadToCloudinary(
  file: File,
  folder: CloudinaryUploadFolder,
  resourceType: 'image' | 'auto',
  configErrorMessage: string,
  uploadErrorMessage: string,
): Promise<string> {
  let signaturePayload: CloudinarySignature;
  try {
    const { data } = await apiClient.post<CloudinarySignature>(
      '/uploads/cloudinary-signature',
      { folder },
    );
    signaturePayload = data;
  } catch (err) {
    // Mirrors the api's own "pending credentials" error (503) when no
    // Cloudinary account has been created yet — surfaced here as the same
    // blocking ImageUploadError the caller already expects, rather than
    // leaking a raw ApiError.
    throw new ImageUploadError(
      err instanceof ApiError ? err.message : configErrorMessage,
    );
  }

  const { signature, timestamp, apiKey, cloudName } = signaturePayload;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', apiKey);
  formData.append('timestamp', String(timestamp));
  formData.append('folder', folder);
  formData.append('signature', signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    { method: 'POST', body: formData },
  );

  if (!response.ok) {
    throw new ImageUploadError(uploadErrorMessage);
  }

  const result = (await response.json()) as { secure_url?: string };
  if (!result.secure_url) {
    throw new ImageUploadError(
      'La subida del archivo no devolvió una URL válida.',
    );
  }

  return result.secure_url;
}

// Registering a payment must still work without a photo (both this phase's
// api and client docs are explicit about that), so this is only called
// when the collector actually picked a file — never a required step.
export async function uploadPaymentReceipt(file: File): Promise<string> {
  // The picker's own accept="image/*,application/pdf" is only a hint — a
  // user can still switch it to "all files" or drop something else in.
  if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
    throw new ImageUploadError(
      `"${file.name}" no es una foto ni un PDF. El comprobante debe ser una imagen o un PDF.`,
    );
  }
  return uploadToCloudinary(
    file,
    'payment-receipts',
    'auto',
    'La subida de archivos no está configurada (faltan las credenciales de Cloudinary en el api).',
    'No se pudo subir el comprobante. Intenta de nuevo.',
  );
}

// Phase 21 — the client ID document (front/back, or a single combined
// PDF), the co-debtor's ID document, and the data-processing consent
// evidence document all reuse this one function: same
// upload-before-submit pattern as uploadPaymentReceipt above, just
// widened to accept image/* or application/pdf (enforced by the caller's
// <input accept="image/*,application/pdf">, not re-checked here — the
// `auto` resource type accepts either regardless). Every field this backs
// is optional on the api side except the consent evidence document, which
// is optional too — see docs/phases/PHASE_21_CLIENT_PROFILE.md decision 3.
export async function uploadDocument(file: File): Promise<string> {
  return uploadToCloudinary(
    file,
    'client-documents',
    'auto',
    'La subida de archivos no está configurada (faltan las credenciales de Cloudinary en el api).',
    'No se pudo subir el archivo. Intenta de nuevo.',
  );
}
