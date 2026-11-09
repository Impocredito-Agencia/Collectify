const PLACEHOLDER_PATTERN = /\{\{(\d+)\}\}/g;

// Every "{{...}}" in the text that won't be replaced at send time: a number
// outside 1..parameterCount, or anything malformed ("{{ 1 }}", "{{a}}", a
// lone "{{"). Left in, it would reach the client literally.
export function findInvalidPlaceholders(
  text: string,
  parameterCount: number,
): string[] {
  const invalid: string[] = [];
  const withoutValid = text.replace(
    PLACEHOLDER_PATTERN,
    (match, number: string) => {
      const index = Number(number);
      if (index < 1 || index > parameterCount) {
        invalid.push(match);
      }
      return '';
    },
  );
  const leftovers = withoutValid.match(/\{\{[^}]*\}?\}?|\}\}/g) ?? [];
  return [...invalid, ...leftovers];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BOLD_PATTERN = /\*([^*\n]+)\*/g;

// The email body is written as plain text (same *bold* convention as
// WhatsApp), never as HTML: the admin can't break the layout or inject
// markup, and a client's own data in a parameter (a name, a product
// description) is escaped like any other text.
export function renderEmailHtml(text: string): string {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) =>
      escapeHtml(paragraph.trim())
        .replace(BOLD_PATTERN, '<strong>$1</strong>')
        .replace(/\n/g, '<br>'),
    )
    .map((paragraph) => `<p style="margin:0 0 16px">${paragraph}</p>`)
    .join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222">${paragraphs}</div>`;
}

// The plain-text alternative sent alongside the HTML.
export function renderEmailText(text: string): string {
  return text.trim().replace(BOLD_PATTERN, '$1');
}
