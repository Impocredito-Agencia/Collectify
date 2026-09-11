// Human report, 2026-09-10 — every email field in this app used to be a
// bare `type="email"` input with no regex of its own, relying entirely on
// the browser's native email-format check to reject garbage before
// submit. That native check (the WHATWG "valid e-mail address" grammar)
// only allows ASCII in the local part, so a real Colombian client's email
// like "maría.muñoz@gmail.com" got silently blocked from being typed in
// at all — even though the backend's own `@IsEmail()` (validator.js,
// `allow_utf8_local_part: true` by default) already accepts it. Shared
// here (ClientForm.tsx, UserForm.tsx, LoginPage.tsx all use it) instead of
// duplicated per-file, since it's now the same fix in three places.
//
// Deliberately permissive rather than a stricter RFC 5322 pattern: just
// "something@something.something" with no `@` or whitespace on either
// side, case- and Unicode-insensitive (the `u` flag), so accented
// letters/ñ and the usual `. _ -` symbols all pass — this only needs to
// catch an obviously malformed value, the same division of labor a
// client-side regex already has with the backend elsewhere in this app
// (e.g. ClientForm.tsx's CO_PHONE_REGEX).
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
