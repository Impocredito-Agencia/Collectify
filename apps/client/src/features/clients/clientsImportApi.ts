/**
 * The three endpoints here don't fit apiClient.ts's shape: the upload is
 * multipart/form-data (not JSON), and the two "download an .xlsx" endpoints
 * return a raw binary file (ClientsImportController uses @Res() to bypass
 * the global {success, data} envelope entirely — see that controller's
 * comment). So this file talks to the API directly with fetch, reusing
 * tokenStore the same way apiClient.ts does, rather than forcing these
 * through a JSON-shaped wrapper that doesn't apply here.
 *
 * Renamed from clientLoanImportApi.ts (2026-09-06) — ClientsImportController
 * only ever creates clients now; assigning a loan to one of them is a
 * separate upload (see apps/api/src/loanImport, matched by cédula). The
 * route path itself was `/clients/import-with-loans` until 2026-09-16,
 * kept that way deliberately until this file's own rename could ship in
 * the same commit — see that controller's own comment.
 */

import { ApiError } from '@/lib/apiClient';
import { tokenStore } from '@/lib/tokenStore';

const API_URL = import.meta.env.VITE_API_URL;

export interface RowError {
  row: number;
  reason: string;
  rawValues: Record<string, string>;
}

export interface ClientsImportResult {
  totalRows: number;
  created: number;
  // A row whose cédula already matched an existing client with no
  // conflicting data — nothing was created, but it's not an error either.
  // Kept separate from `created` so the summary doesn't overstate how many
  // new clients actually landed.
  alreadyExisted: number;
  skipped: RowError[];
}

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

// Both template download and errors-export are POST-and-get-a-file-back —
// triggers a normal browser download via a throwaway <a download> click,
// same trick used for any client-side file save with no dedicated API.
async function downloadFile(
  path: string,
  filename: string,
  errorMessage: string,
  body?: unknown,
): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new ApiError(errorMessage, response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const clientsImportApi = {
  downloadTemplate: (): Promise<void> =>
    downloadFile(
      '/clients/import-template',
      'plantilla-clientes.xlsx',
      'No se pudo descargar la plantilla',
    ),

  exportErrors: (errors: RowError[]): Promise<void> =>
    downloadFile(
      '/clients/import-errors-export',
      'errores-de-importacion.xlsx',
      'No se pudo generar el archivo de errores',
      { errors },
    ),

  importFile: async (file: File): Promise<ClientsImportResult> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_URL}/clients/import-clients`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    const payload = (await response.json()) as
      | { success: true; data: ClientsImportResult }
      | { success: false; message: string; statusCode: number };

    if (!payload.success) {
      throw new ApiError(payload.message, payload.statusCode);
    }
    return payload.data;
  },
};
