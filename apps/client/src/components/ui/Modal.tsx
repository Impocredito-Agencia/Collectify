import type { ReactNode } from 'react';

// Centralizes the modal/dialog card wrapper — backdrop, radius, border,
// shadow, width — that every one of the app's ~15 dialogs previously
// hand-rolled as its own copy of the same className string. Same
// rationale as Button.tsx: a visual change (the 2026-09-02 shadow-card
// rollout) had to be grepped and reapplied to every file individually
// instead of being a one-line edit here.
interface ModalProps {
  children: ReactNode;
  // Tailwind arbitrary-value max-width class, e.g. 'max-w-[440px]'.
  // Matches each dialog's previous hand-picked width — there's no single
  // "right" width across the app (a confirm dialog is narrower than a
  // multi-field form), so this stays a per-call-site choice.
  maxWidth?: string;
  // Set for a dialog whose content can outgrow the viewport (a long form,
  // or a per-row list like BulkRegisterPaymentDialog) — adds a max-height
  // and its own scrollbar instead of letting the card overflow the
  // screen.
  scroll?: boolean;
  // Tailwind arbitrary-value max-height class, only used when
  // `scroll` is true. Defaults to 90vh; BulkRegisterPaymentDialog uses
  // 85vh instead.
  maxHeight?: string;
}

export function Modal({
  children,
  maxWidth = 'max-w-[440px]',
  scroll = false,
  maxHeight = 'max-h-[90vh]',
}: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className={`w-full ${maxWidth} ${scroll ? `${maxHeight} overflow-y-auto` : ''} rounded-lg border border-border bg-surface shadow-card px-8 py-7`}
      >
        {children}
      </div>
    </div>
  );
}
