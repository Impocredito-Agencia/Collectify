# Phase 12 — Payment Attachments

## Goal

Let a payment carry a photo of the deposit/receipt ("comprobante de consignación") alongside the observation field that already exists but isn't currently rendered anywhere in the client. The `api` only ever stores a URL — image processing/hosting is delegated to an external provider.

## Scope decisions — read before implementing

- **Image hosting provider recommendation: Cloudinary**, as a default. Comparison for the record:
  - **Cloudinary** — free tier (~25 credits/month covering storage + transformations + bandwidth combined), the most mature Node.js SDK, and what the business was already leaning toward. Recommended starting point.
  - **ImageKit** — cheaper at the free tier (~20GB), a solid alternative if Cloudinary's credit system becomes a constraint.
  - **Cloudflare Images** — cheapest at real scale ($5/100K images stored + $1/100K served, no bandwidth charge) and lives in the same ecosystem the `client` app is already deployed to (Cloudflare Pages) — worth revisiting if payment-photo volume grows significantly.
  - At the volume expected for a collections business (photos of deposit receipts, likely in the hundreds per month), any of the three stays free indefinitely. This is a reversible choice — swapping providers later only changes where new uploads go, not the stored URLs of old ones.
- **The `api` never touches image bytes.** The client uploads directly to the provider (signed upload preset or unsigned upload widget, per the provider's recommended client-side flow) and sends only the resulting URL to the `api`. This keeps `apps/api` free of file-handling code and storage costs.
  - **Resolved 2026-09-11: signed, not unsigned.** The original build used an unsigned preset (cloud name + preset name shipped in the client bundle); reworked to a signed upload after a security review flagged that anyone could copy those public values out of devtools and spam uploads to the account without ever logging into Collectify. The api now signs a short-lived upload payload per request via `POST /uploads/cloudinary-signature` (see `apps/api/src/uploads`), tying every upload to an authenticated session — image bytes still never pass through the api. See `docs/ENVIRONMENT_VARIABLES.md`.

## Scope

### Entities and migrations
- [ ] `Payment`: add `image_url` (`VARCHAR`, nullable).
- [ ] Migration `AddImageUrlToPayments`.

### DTO and endpoint
- [ ] `CreatePaymentDto`: add optional `imageUrl` (validated as a well-formed URL string).
- [ ] `InstallmentsController.registerPayment` — no new endpoint needed, extend the existing `POST /api/v1/installments/:id/payments` to accept and persist `imageUrl`.
- [ ] Swagger description on the endpoint explicitly states the `api` does not handle upload — `imageUrl` must already point to the externally hosted image.

### Tests (mandatory)
- [ ] `registerPayment` persists `imageUrl` when provided, and works exactly as before when omitted (backward compatible — `observation` and `imageUrl` are both optional).
- [ ] Invalid `imageUrl` (malformed string) is rejected by DTO validation.

### Swagger
- [ ] Endpoint documented, including the upload-responsibility note above.

## Definition of done for this phase

- A payment can be registered with an attached image URL, stored and returned exactly as submitted.
- All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## After this phase

Add an `ENVIRONMENT_VARIABLES.md` entry for whichever image provider's client-side keys are needed (these are client-only public keys, not server secrets, but document them for completeness since `apps/client` will need them at build time).

## Related documents

- `docs/phases/PHASE_4_LOANS_INSTALLMENTS.md` — the `Payment` entity and `observation` field this phase extends
- `docs/DATABASE.md` — `payments` table
