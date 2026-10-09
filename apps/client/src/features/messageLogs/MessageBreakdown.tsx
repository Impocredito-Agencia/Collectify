interface MessageBreakdownProps {
  breakdownContent: string;
}

// Human report, 2026-10-09 — a reminder covering several cuotas only tells
// the client a count and one summed total, so a cobrador reading the saved
// message couldn't tell which cuotas made it up when the client answered
// with an abono for just one. This is the cuota-by-cuota desglose the API
// snapshotted at send time (MessageLog.breakdownContent). Labeled as
// internal on purpose: it sits right under the real message, and must not
// be mistaken for something the client was sent.
export function MessageBreakdown({ breakdownContent }: MessageBreakdownProps) {
  return (
    <div className="flex flex-col gap-1 rounded border border-dashed border-border px-3 py-2">
      <span className="text-meta text-muted">
        Desglose de cuotas al momento del envío · interno, no se envió al
        cliente
      </span>
      <p className="whitespace-pre-wrap text-small text-white">
        {breakdownContent}
      </p>
    </div>
  );
}
