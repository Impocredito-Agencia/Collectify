import { useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  ClientLoanImportResult,
  clientLoanImportApi,
} from '@/features/clients/clientLoanImportApi';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface ImportClientsDialogProps {
  onClose: () => void;
  // Called after a successful upload so the caller can refetch the
  // clients list — matches the "created" count in the summary, which
  // silently goes stale otherwise if the admin doesn't manually refresh.
  onImported?: () => void;
}

// No Figma frame for this — 100% new per the Phase 8 scope confirmed with
// the client (2026-08-19, see docs/phasesClient/PHASE_8_POLISH.md). One
// row of the uploaded file = one credit; the same cédula can repeat
// across rows for a client with several loans. All-or-nothing per row —
// see ClientLoanImportService for the exact rule.
//
// "Modo de carga" (normal/histórico) removed 2026-09-03 — client
// feedback: "histórico" (which skipped the mora/cupo guard, for bulk-
// loading loans already overdue or out of credit limit) was never used
// in practice, just an extra decision in the dialog for no benefit. Every
// upload now goes through the same guard as creating a loan by hand — see
// ClientLoanImportService.processRow's comment on this.
export function ImportClientsDialog({
  onClose,
  onImported,
}: ImportClientsDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isExportingErrors, setIsExportingErrors] = useState(false);
  const [result, setResult] = useState<ClientLoanImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(onClose);

  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true);
    setError(null);
    try {
      await clientLoanImportApi.downloadTemplate();
    } catch {
      setError('No se pudo descargar la plantilla. Intenta de nuevo.');
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    setResult(null);
    try {
      const summary = await clientLoanImportApi.importFile(file);
      setResult(summary);
      if (summary.created > 0) {
        onImported?.();
      }
    } catch {
      setError(
        'No se pudo procesar el archivo — revisa que sea el .xlsx de la plantilla y vuelve a intentar.',
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleExportErrors = async () => {
    if (!result || result.skipped.length === 0) return;
    setIsExportingErrors(true);
    try {
      await clientLoanImportApi.exportErrors(result.skipped);
    } catch {
      setError('No se pudo generar el archivo de errores.');
    } finally {
      setIsExportingErrors(false);
    }
  };

  return (
    <Modal maxWidth="max-w-[560px]">
      <h2 className="text-card-title font-medium text-white">
        Importar clientes y créditos
      </h2>
      <p className="mt-2.5 text-small text-muted">
        Cada fila del archivo representa un crédito — un mismo cliente puede
        repetirse en varias filas si tiene más de un préstamo.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {/* Was a hand-typed <button> that copy-pasted the "secondary"
            look but with the base text color set to white instead of
            muted — since its hover was also white, the hover had no
            visible effect. Migrated to the shared Button component so
            this can't drift from the rest of the app's hover behavior
            again — see Button.tsx's own comment on why every button goes
            through it. */}
        <Button
          variant="secondary"
          onClick={() => void handleDownloadTemplate()}
          disabled={isDownloadingTemplate}
          className="w-fit"
        >
          {isDownloadingTemplate ? 'Descargando…' : 'Descargar plantilla'}
        </Button>

        <div>
          <label className="mb-1.5 block text-label text-muted">
            Archivo (.xlsx)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
            className="w-full text-small text-white"
          />
        </div>

        {error && (
          <p className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-small text-danger">
            {error}
          </p>
        )}

        {result && (
          <div className="rounded border border-border bg-input px-4 py-3">
            <p className="text-small text-white">
              {result.created} de {result.totalRows} filas cargadas
              correctamente.
            </p>
            {result.skipped.length > 0 && (
              <>
                <p className="mt-1 text-small text-danger">
                  {result.skipped.length} fila(s) con error:
                </p>
                <ul className="mt-1.5 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-meta text-muted">
                  {result.skipped.map((row) => (
                    <li key={row.row}>
                      Fila {row.row}: {row.reason}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  onClick={() => void handleExportErrors()}
                  disabled={isExportingErrors}
                  className="mt-2.5 w-fit"
                >
                  {isExportingErrors
                    ? 'Generando…'
                    : 'Descargar filas con error'}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-border" />

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
        <Button
          variant="neutral"
          onClick={() => void handleUpload()}
          disabled={!file || isUploading}
        >
          {isUploading ? 'Subiendo…' : 'Subir archivo'}
        </Button>
      </div>
    </Modal>
  );
}
