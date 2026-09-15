/**
 * GET /clients/reports/overdue-installments returns a raw .xlsx file (same
 * @Res()-bypasses-the-envelope pattern as clientsImportApi.ts's downloads),
 * so this talks to the API directly with fetch rather than apiClient.ts.
 * Nested under an extra "reports" segment (not just /clients/overdue-
 * installments-report) so it can never collide with GET /clients/:id — see
 * OverdueInstallmentsReportController's own comment on the bug this fixed.
 */

import { ApiError } from '@/lib/apiClient';
import { tokenStore } from '@/lib/tokenStore';

const API_URL = import.meta.env.VITE_API_URL;
const FALLBACK_FILENAME = 'cuotas_vencidas.xlsx';

function authHeaders(): HeadersInit {
  const accessToken = tokenStore.getAccessToken();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

// The backend names the file with today's date (Bogotá calendar day) — read
// it from Content-Disposition instead of guessing the date client-side, so
// the two can never drift apart.
function filenameFrom(response: Response): string {
  const header = response.headers.get('Content-Disposition');
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? FALLBACK_FILENAME;
}

async function downloadOverdueInstallmentsReport(): Promise<void> {
  const response = await fetch(
    `${API_URL}/clients/reports/overdue-installments`,
    {
      headers: authHeaders(),
    },
  );
  if (!response.ok) {
    throw new ApiError(
      'No se pudo generar el reporte de cuotas vencidas',
      response.status,
    );
  }
  const filename = filenameFrom(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const overdueInstallmentsReportApi = {
  download: downloadOverdueInstallmentsReport,
};
