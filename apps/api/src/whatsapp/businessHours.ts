// Confirmed with the human, 2026-09-13: lunes a viernes 9am–7pm, sábados
// 9am–4pm, domingos cerrado. No festivos check — deliberately dropped as
// unnecessary work for this business's volume (there's no holiday-date
// source anywhere in this codebase to begin with).
//
// Same fixed UTC-5 offset technique as
// loans/installments/installmentCalculations.ts's BOGOTA_UTC_OFFSET_MS —
// Colombia has no DST, so a plain arithmetic shift is enough; no need for
// Intl.DateTimeFormat's timezone database lookups.
const BOGOTA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

const SUNDAY = 0;
const SATURDAY = 6;

// Used to decide which copy SelfServiceMenuService sends for "Hablar con
// asesor" / a receipt arriving — a plain free-form session message (not a
// Meta template), so this can change here freely without needing Meta
// re-approval, unlike a real WhatsApp template.
export function isWithinBusinessHours(now: Date = new Date()): boolean {
  const bogotaInstant = new Date(now.getTime() - BOGOTA_UTC_OFFSET_MS);
  const dayOfWeek = bogotaInstant.getUTCDay();
  const hour = bogotaInstant.getUTCHours();

  if (dayOfWeek === SUNDAY) {
    return false;
  }
  if (dayOfWeek === SATURDAY) {
    return hour >= 9 && hour < 16;
  }
  return hour >= 9 && hour < 19;
}
