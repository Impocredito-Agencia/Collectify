// Human report, 2026-09-14 — MessageLog.messageContent used to store
// bodyParameters.join(' | '), a raw debug rendering that never matched what
// the client actually saw on WhatsApp (Meta's real approved template text,
// with these values filled into its {{1}}, {{2}}, ... placeholders). This
// interpolates MessageTemplate.content the same way Meta does, so the log
// shows the real message instead.
//
// Rendered once, at send time, and stored as the snapshot — deliberately
// not re-derived later at read time against whatever a template's content
// happens to be then. MessageTemplate.content is "fixed per type, not
// admin-editable" (see that entity's own comment), but it CAN change via a
// migration if a template is ever resubmitted to Meta with revised wording;
// a historical MessageLog must keep showing what was actually sent, not be
// silently rewritten to match a later revision.
export function renderTemplateBody(
  content: string,
  bodyParameters: string[],
): string {
  return bodyParameters.reduce(
    (text, parameter, index) => text.replaceAll(`{{${index + 1}}}`, parameter),
    content,
  );
}
