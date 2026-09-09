// Colombian numbers are stored/validated as +57 followed by 10 digits (see
// features/clients/ClientForm.tsx's CO_PHONE_REGEX). This just adds spacing
// for readability in the UI — the stored value is untouched.
// "+573205704455" -> "+57 320 570 4455"
export function formatPhoneNumber(phoneNumber: string): string {
  const match = /^(\+57)(\d{3})(\d{3})(\d{4})$/.exec(phoneNumber);
  if (!match) {
    return phoneNumber;
  }
  const [, prefix, part1, part2, part3] = match;
  return `${prefix} ${part1} ${part2} ${part3}`;
}

// Colombian peso formatting (dot as thousands separator, no cents shown —
// amounts are DECIMAL(12,2) but the business always deals in whole pesos in
// every real example seen in docs/DATABASE.md). Used across Préstamos.
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Two-letter initials from a full name (e.g. "Ana Gómez" -> "AG"), for
// avatar circles (Sidebar footer, ProfilePage). Falls back to the first
// letter alone if there's no second word.
export function getInitials(fullName: string): string {
  const [first, second] = fullName.trim().split(/\s+/);
  return `${first?.charAt(0) ?? ''}${second?.charAt(0) ?? ''}`.toUpperCase();
}

// Sidebar footer's name+role column is only ~130-140px wide (style
// cleanup, 2026-09-02) — a plain CSS `truncate` cuts a long full name off
// mid-character ("Juan Miguel Rincón H..."), which the client said looked
// bad. Rather than guess a pixel-perfect fit, this abbreviates only the
// LAST word to an initial once the name is long enough to likely overflow
// ("Juan Miguel Rincón Hernández" → "Juan Miguel Rincón H."), and leaves
// short names untouched. The 20-char threshold is an approximation (~6px
// average character width at the column's 11px font, ~130px budget), not
// a measured pixel fit — `truncate` stays on the span as a safety net for
// any name that's still too wide after this.
export function formatSidebarName(fullName: string): string {
  const trimmed = fullName.trim();
  const parts = trimmed.split(/\s+/);
  if (trimmed.length <= 20 || parts.length <= 1) {
    return trimmed;
  }
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(' ')} ${last.charAt(0)}.`;
}

// Renders a date-ONLY string ('YYYY-MM-DD' — disbursedAt, installment
// dueDate, payment paidAt: all Postgres 'date' columns, no time-of-day) for
// display. `new Date('2026-10-01')` parses that as UTC midnight; calling
// .toLocaleDateString() on it converts that instant to the BROWSER's local
// timezone before formatting, which rolls the calendar day back by one for
// any timezone behind UTC — e.g. America/Bogota (UTC-5) turns "2026-10-01"
// into "30/9/2026". Forcing timeZone: 'UTC' keeps the date-only string's
// actual calendar day intact regardless of the viewer's clock. Don't use
// this for real timestamps (createdAt/updatedAt) — those should keep
// converting to the viewer's local time, which is the correct behavior.
export function formatDateOnly(dateString: string): string {
  return new Date(dateString).toLocaleDateString('es-CO', {
    timeZone: 'UTC',
  });
}

// createdAt is a real timestamp (TypeORM @CreateDateColumn), not a
// date-only column — unlike formatDateOnly above, this should convert to
// the viewer's LOCAL time. "Enero 2025" matches the "Mi perfil" Figma
// design's "Desde" field exactly (month + year only, capitalized —
// toLocaleDateString lowercases the month name in es-CO). Shared between
// ProfilePage.tsx (the logged-in admin's own account) and
// UserDetailPage.tsx (Phase 20 follow-up's "Ver perfil", any account) —
// moved here when the second call site needed it.
export function formatMemberSince(isoDateTime: string): string {
  const label = new Date(isoDateTime).toLocaleDateString('es-CO', {
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Client request, 2026-09-08 — age isn't its own stored column (see
// AddGenderToClients1789000000000's own comment): it's computed here from
// the existing dateOfBirth ('YYYY-MM-DD', a Postgres 'date' column) instead
// of duplicating a value that would silently go stale. Display-only, not a
// financial calculation, so this doesn't need the Bogotá-specific
// whole-calendar-day precision the API's mora calculations do — but still
// parses the string by hand (not `new Date(dateOfBirth)`) to sidestep the
// same UTC-midnight-parsing pitfall formatDateOnly's own comment describes.
export function calculateAge(dateOfBirth: string): number {
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  const hasHadBirthdayThisYear =
    today.getMonth() + 1 > month ||
    (today.getMonth() + 1 === month && today.getDate() >= day);
  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }
  return age;
}

// Phase 21 — the client document-upload fields (idDocumentFrontUrl,
// consentDocumentUrl, ...) accept either an image or a PDF
// (lib/imageUpload.ts#uploadDocument).
// Display code needs to know which, since an <img> tag can't render a
// PDF — a PDF should open as a plain link/new tab instead of going through
// components/ui/ImageLightbox.tsx. Cloudinary's secure_url keeps the
// original file extension, so checking the URL's own extension (ignoring
// any query string) is reliable without a network round-trip.
export function isPdfUrl(url: string): boolean {
  return /\.pdf(?:[?#]|$)/i.test(url);
}
