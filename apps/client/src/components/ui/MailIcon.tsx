// Envelope icon — inline SVG, same approach as PlusIcon (no icon library in
// this app). Phase 36: marks the "Correo y SMS" entry on Plantillas.
export function MailIcon() {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <rect
        x="2.75"
        y="4.75"
        width="14.5"
        height="10.5"
        rx="1.75"
        strokeWidth="1.5"
      />
      <path
        d="M3.5 6l6.5 4.75L16.5 6"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
