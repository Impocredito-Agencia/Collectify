import { useState } from 'react';

import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { Td, Th } from '@/components/ui/Table';
import { formatCurrency, formatDateOnly, isPdfUrl } from '@/lib/format';

import type { Payment } from '@/features/installments/installmentsApi';

// Phase 35 — the deleted pagaré's payments, every one voided by the
// deletion (or earlier, by hand), each with its receipts and the reason it
// was voided. Same receipt treatment as LoanDetailPage's payment history:
// image thumbnails open in the lightbox, a PDF opens in a new tab.
export function DeletedLoanPaymentsTable({
  payments,
}: {
  payments: Payment[];
}) {
  const [enlargedImage, setEnlargedImage] = useState<{
    url: string;
    alt: string;
  } | null>(null);

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-section-label font-normal tracking-normal text-subtle">
        Pagos (anulados)
      </span>
      {payments.length === 0 ? (
        <p className="text-small text-muted">
          Este pagaré no tenía pagos registrados.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-surface">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="bg-input">
              <tr className="divide-x divide-border">
                <Th>Fecha</Th>
                <Th>Monto</Th>
                <Th>Observación</Th>
                <Th>Comprobante</Th>
                <Th>Motivo de anulación</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr
                  key={payment.id}
                  className="divide-x divide-border border-t border-border"
                >
                  <Td>{formatDateOnly(payment.paidAt)}</Td>
                  <Td>{formatCurrency(payment.amountPaid)}</Td>
                  <Td muted>{payment.observation ?? '—'}</Td>
                  <Td>
                    {payment.imageUrls.length > 0 ? (
                      <div className="flex items-center gap-1.5">
                        {payment.imageUrls.map((imageUrl, imageIndex) => {
                          const alt = `Comprobante ${imageIndex + 1} del pago del ${formatDateOnly(payment.paidAt)}`;
                          return isPdfUrl(imageUrl) ? (
                            <a
                              key={imageUrl}
                              href={imageUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`${alt} (PDF)`}
                              className="flex h-8 w-8 items-center justify-center rounded border border-border bg-input text-[9px] text-muted hover:border-subtle hover:text-white"
                            >
                              PDF
                            </a>
                          ) : (
                            <button
                              key={imageUrl}
                              type="button"
                              onClick={() =>
                                setEnlargedImage({ url: imageUrl, alt })
                              }
                              className="block"
                            >
                              <img
                                src={imageUrl}
                                alt={alt}
                                className="h-8 w-8 rounded border border-border object-cover hover:border-subtle"
                              />
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-meta text-mid">—</span>
                    )}
                  </Td>
                  <Td muted>{payment.voidReason ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {enlargedImage && (
        <ImageLightbox
          imageUrl={enlargedImage.url}
          alt={enlargedImage.alt}
          onClose={() => setEnlargedImage(null)}
        />
      )}
    </div>
  );
}
