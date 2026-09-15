// Shared across the *.spec.ts files that mock MessageTemplatesService — a
// generic body with enough numbered placeholders for any test's
// bodyParameters array, regardless of how many values that particular
// template selection produces. Only messageContent's rendering is under
// test at the call sites that use this; nothing asserts on the literal
// wording here.
export const GENERIC_TEMPLATE_CONTENT = Array.from(
  { length: 15 },
  (_, index) => `{{${index + 1}}}`,
).join(' ');
