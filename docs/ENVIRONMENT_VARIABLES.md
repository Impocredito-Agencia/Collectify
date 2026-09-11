# Environment Variables

This document explains every environment variable used across `api` and `client`, what it's for, and where to get its value.

## Environments

Currently the project runs in two contexts:

- **Local development** — your machine, using the `.env` file, with PostgreSQL running via Docker.
- **Production** — `api` on Railway, `client` on Cloudflare Workers with static assets, per the original Phase 1 plan (Cloudflare's current recommended path for static sites, replacing the classic Pages product). Variables are set through each platform's dashboard, never committed to the repo. See "Deploying" below for the full walkthrough.

There's no separate staging environment right now — Vercel was used for that early on but is no longer part of the setup (staging's own Postgres plugin was separate from production's, so nothing from it carries over). Workers Builds gives an automatic **preview deployment** per branch/PR out of the box (once non-production branch builds are enabled on the trigger), which can stand in for manual QA on the `client` side when needed; there's no equivalent yet on the `api` side.

## General rules

- **Never commit a `.env` file.** It's listed in `.gitignore` for exactly this reason.
- **Every variable must exist in `.env.example`**, with a placeholder or dummy value — this is how a new developer knows what to fill in.
- If you add a new environment variable, update `.env.example` **and** this document in the same Pull Request (see `DEFINITION_OF_DONE.md`).
- Production values are set directly in Railway's / Cloudflare Workers' environment variable settings — never sent over Slack, WhatsApp, or committed anywhere.

---

## API (`apps/api/.env`)

```bash
# ── Server ──────────────────────────────────────────────
NODE_ENV=development
PORT=3000

# ── Database ────────────────────────────────────────────
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=collectify

# ── Auth ────────────────────────────────────────────────
JWT_SECRET=replace-with-a-long-random-string
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# ── WhatsApp — Meta Cloud API ───────────────────────────
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_BUSINESS_ACCOUNT_ID=

# ── WhatsApp — inbound webhook (Phase 22) ───────────────
META_WHATSAPP_WEBHOOK_VERIFY_TOKEN=
META_WHATSAPP_APP_SECRET=

# ── WhatsApp — global kill switch (2026-09-06 incident response) ──
WHATSAPP_SENDING_PAUSED=false

# ── WhatsApp — test allowlist (2026-09-08) ──────────────
WHATSAPP_TEST_RECIPIENTS=

# ── WhatsApp — payment confirmation kill switch (2026-09-11) ──
PAYMENT_CONFIRMATION_MESSAGES_PAUSED=false

# ── Scheduled jobs ──────────────────────────────────────
OVERDUE_REMINDER_CRON=0 9 * * 1,3,5
UPCOMING_DUE_REMINDER_CRON=0 8 * * *
UPCOMING_DUE_REMINDER_DAYS=5
ACCOUNT_SUMMARY_REMINDER_CRON=0 8 1 * *
NEW_LOAN_REMINDER_CRON=0 10 * * 1

# ── File uploads — Cloudinary signed uploads (Phase 12) ─
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# ── CORS ────────────────────────────────────────────────
CLIENT_URL=http://localhost:5173
```

### Variable reference

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | ✅ | `development` locally, `production` on Railway. Controls things like error verbosity and TypeORM `synchronize` (always `false`, see `DATABASE.md`). |
| `PORT` | ✅ | Port the API listens on. Railway overrides this automatically in production via its own `PORT` variable. |
| `DATABASE_HOST` | ✅ | `localhost` locally (via Docker); Railway provides this automatically in production through its PostgreSQL plugin. |
| `DATABASE_PORT` | ✅ | `5432` by default. |
| `DATABASE_USER` | ✅ | Postgres user. Matches the `docker-compose.yml` credentials locally. |
| `DATABASE_PASSWORD` | ✅ | Postgres password. **Never use the local default value in production** — Railway generates a strong one automatically. |
| `DATABASE_NAME` | ✅ | Database name, `collectify` by convention. |
| `JWT_SECRET` | ✅ | Single secret used to sign both access and refresh tokens. Must be a long, random string in production (generate with `openssl rand -hex 64`). **Never reuse the local dev value in production.** |
| `JWT_ACCESS_EXPIRATION` | ✅ | Access token lifetime. `15m` is the current standard — short-lived by design. |
| `JWT_REFRESH_EXPIRATION` | ✅ | Refresh token lifetime. `7d` — after this, the user must log in again. |
| `META_WHATSAPP_PHONE_NUMBER_ID` | ⚠️ Pending | Meta's identifier for the WhatsApp Business phone number. **Not yet available — the client hasn't set up their Meta Business account.** Leave blank locally until provided; the `whatsapp` module should handle a missing value gracefully in development (log instead of send). |
| `META_WHATSAPP_ACCESS_TOKEN` | ⚠️ Pending | Access token from the Meta for Developers app. Same status as above — pending client setup. |
| `META_WHATSAPP_BUSINESS_ACCOUNT_ID` | ⚠️ Pending | The WhatsApp Business Account ID tied to the Meta app. Same status as above. |
| `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | ✅ | Added Phase 22. An admin-chosen random string, checked against Meta's `hub.verify_token` during the one-time webhook verification handshake (`GET /whatsapp/webhook`) — generate with `openssl rand -hex 32`. Must match whatever is entered in the Meta App Dashboard's webhook configuration. |
| `META_WHATSAPP_APP_SECRET` | ✅ | Added Phase 22. The Meta app's own secret (App Dashboard → Settings → Basic), used to verify the `X-Hub-Signature-256` header on every inbound webhook POST — this is what proves a request actually came from Meta. Never log or expose this value. |
| `WHATSAPP_SENDING_PAUSED` | ✅ | Added 2026-09-06 (incident response — needed to pause every outbound WhatsApp send while re-importing real client/loan data). `true`/`false`, default `false`. When `true`, `WhatsAppService`'s three send methods (text, template, interactive buttons) short-circuit before ever calling Meta's API — covers every message type unconditionally: cron reminders, the synchronous new-loan/payment-confirmation sends, and self-service menu replies alike. Toggle back to `false` (or unset) and redeploy/restart to resume sending — see the relevant PR for the reactivation plan once decided. |
| `WHATSAPP_TEST_RECIPIENTS` | ⚠️ Optional | Added 2026-09-08 — comma-separated E.164 phone numbers (e.g. `+573001234567,+573007654321`) that bypass `WHATSAPP_SENDING_PAUSED`: a send to one of these numbers goes out for real even while the kill switch above stays `true` for everyone else. Lets a real end-to-end WhatsApp test run (own phone + another developer's) without lifting the pause for the whole client base. Empty by default — no bypass happens unless explicitly set. **Never commit real phone numbers** — leave this blank in `.env.example` and set the real value only in Railway's Variables tab (or a local, gitignored `.env`). Remove the variable (or clear it) once testing is done; it has no effect while `WHATSAPP_SENDING_PAUSED` is `false`. See `apps/api/src/database/seedWhatsappTestData.ts` and `cleanupWhatsappTestData.ts` for the paired test-data scripts. |
| `PAYMENT_CONFIRMATION_MESSAGES_PAUSED` | ✅ | Added 2026-09-11 — `true`/`false`, default `false`. A narrower kill switch than `WHATSAPP_SENDING_PAUSED` above: stops only `PaymentConfirmationService`'s two message types (`PaymentConfirmation`, `PaidInFull`), checked before either ever reaches `WhatsAppService` — so no `message_logs` row gets created for them at all while this is `true`, not even a `Failed` one. Exists because historical payments are being backfilled alongside historical loans (`Loan.isNewLoan` already stops the "nuevo pagaré" message for those); there's no per-payment equivalent flag to key off of, so this pauses the message type globally instead until real payments start flowing through normally. Independent of `WHATSAPP_SENDING_PAUSED` — the two compose (either one blocks), so flipping this back to `false` doesn't resume sends if the global switch is still `true`. |
| `OVERDUE_REMINDER_CRON` | ✅ | Cron expression controlling when the overdue reminder job runs. Default `0 9 * * 1,3,5` = every Monday, Wednesday, and Friday at 9:00 AM. Changed from a single weekly run (Monday only) at the client's request — the message content is still one consolidated summary per client, it's just sent three times a week instead of once. |
| `UPCOMING_DUE_REMINDER_CRON` | ✅ | Cron expression controlling when the daily upcoming-due ("Aviso") reminder job runs. Default `0 8 * * *` = every day at 8:00 AM. Added in Phase 9 — see `docs/phases/PHASE_9_MESSAGE_TYPES.md`. |
| `UPCOMING_DUE_REMINDER_DAYS` | ✅ | Single number, default `5` — size in days of the "due soon" reminder window (remind while an installment is due within the next N days). Added in Phase 9 as a comma-separated list of three exact day-before-due checkpoints (`5,3,1`); **reworked 2026-09-07 (human)** to a cumulative window instead, since an exact-day match silently drops a reminder whenever the admin's cron day-of-week picker skips the one day that check needed — see `reminderInstallmentQueries.ts`'s doc comment. Simplified from a list to a single number the same day, once only the max of the three values was ever used. |
| `ACCOUNT_SUMMARY_REMINDER_CRON` | ✅ | Cron expression for the account-summary cron (Phase 18) — sends to every client with at least one active loan (corrected after client QA, 2026-08-18; originally audience-only). Default `0 8 1 * *` = 8:00 AM on the 1st of each month. Admin-editable via `MessageTemplate.cronExpression`, which takes precedence over this code default when set — see `docs/phases/PHASE_18_MESSAGE_AUDIENCES.md`. |
| `NEW_LOAN_REMINDER_CRON` | ✅ | Restored 2026-09-09 (confirmed with the human). Cron expression for the "new loan"/refinance family (`ReminderFamily.NewLoan`) — sweeps loans where `is_new_loan` is true and `new_loan_message_sent_at` is still null, per the schedule below. Default `0 10 * * 1` = every Monday at 10:00 AM. Admin-editable via `MessageTemplate.cronExpression`, same precedence as the other cron vars above. `Loan.isNewLoan` now defaults to `false` on both the create DTO and the `LoanForm` checkbox (unchecked by default) — most loans entered right now are historical backfills, so an admin has to actively opt a loan into the sweep. Payment confirmation and "pagado en su totalidad" are NOT part of this — they stay synchronous, unaffected by this variable. See `Loan.isNewLoan` and `NewLoanReminderService.runPendingLoanNotifications`. |
| `CLOUDINARY_CLOUD_NAME` | ⚠️ Pending | Cloudinary's cloud name. Shared by two callers of `UploadsService`: the browser-authenticated upload flow (payment receipts, client documents) and `WhatsappMediaService`'s server-side re-hosting of a client's inbound WhatsApp attachment. **Not yet available — no Cloudinary account has been created for this project yet.** See `docs/phases/PHASE_12_PAYMENT_ATTACHMENTS.md` for the provider comparison and recommendation. |
| `CLOUDINARY_API_KEY` | ⚠️ Pending | Cloudinary's API key (Settings → Account → API Keys). Same pending status as above. |
| `CLOUDINARY_API_SECRET` | ⚠️ Pending | Cloudinary's API secret. **Never expose this to the client** — it's what lets `UploadsService` sign every upload server-side, browser-requested or not. Same pending status as above. |
| `CLIENT_URL` | ✅ | The client's URL, used to configure CORS. `http://localhost:5173` locally; the Cloudflare Workers URL in production. |

### On the pending Meta Cloud API credentials

Since the client hasn't finished setting up their Meta Business account yet, the `WhatsAppService` should be built to **fail gracefully** when these variables are empty — logging a warning and skipping the actual API call — rather than crashing the whole application on startup. This lets development continue on every other module without being blocked. Once the client provides these values, they get added to Railway's production environment variables (and to a developer's local `.env` for testing against the real API).

---

## Client (`apps/client/.env.local`)

Vite only exposes variables prefixed with `VITE_` to the frontend code — this is a security measure so that server-only secrets are never accidentally bundled into the browser build.

```bash
VITE_API_URL=http://localhost:3000/api/v1
```

### Variable reference

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | ✅ | Base URL the client uses to reach the API. Points to `localhost:3000` locally; points to the Railway-deployed API URL in production. |

Accessed in code as:

```typescript
const apiUrl = import.meta.env.VITE_API_URL;
```

### Cloudinary uploads are signed by the api, not configured on the client

Payment receipt photos (Phase 12) and client ID/consent documents (Phase 21) used to upload straight to Cloudinary from the browser using an **unsigned** upload preset — `VITE_CLOUDINARY_CLOUD_NAME`/`VITE_CLOUDINARY_UPLOAD_PRESET`, both public values baked into the client bundle. That was reworked to a **signed** upload: the client first calls `POST /api/v1/uploads/cloudinary-signature` (see `apps/api/src/uploads`), which signs a short-lived upload payload using `CLOUDINARY_API_SECRET` — a value that only ever lives on the api — then uploads the file straight to Cloudinary with that payload. Image bytes still never pass through the api, only the small signature payload does. This closes the gap where anyone could've copied the public preset name out of devtools and spammed uploads to the account without ever logging into Collectify. See the `CLOUDINARY_*` vars in the `api` section above.

Unlike the pending Meta WhatsApp credentials (which the `api` handles by logging and skipping a background cron job), a missing Cloudinary config has no reasonable "skip silently" behavior here — registering a payment with a photo is a direct, in-the-moment user action, not a scheduled job. The signature endpoint throws a clear `ServiceUnavailableException` instead, which `lib/imageUpload.ts` surfaces to the caller as an `ImageUploadError`, and `RegisterPaymentDialog.tsx` renders as a blocking error message rather than letting the payment submit without the photo. Registering a payment with **no** photo at all is unaffected either way — the field is optional end to end.

---

## Setting variables in production

- **Railway (`api`)**: Project → Variables tab. When a PostgreSQL plugin is attached to the same Railway project, reference its values instead of hardcoding them — e.g. set `DATABASE_HOST` to `${{Postgres.PGHOST}}`, `DATABASE_PORT` to `${{Postgres.PGPORT}}`, and so on for `DATABASE_USER`/`DATABASE_PASSWORD`/`DATABASE_NAME` against `PGUSER`/`PGPASSWORD`/`PGDATABASE`. This keeps the API in sync automatically if the plugin ever rotates credentials.
- **Cloudflare Workers (`client`)**: since `VITE_*` variables are baked into the build at build time (not read at runtime), they must be set as **build variables**, not runtime ones — Worker → Settings → Builds → your trigger → Build variables and secrets. Setting them under Settings → Variables & Secrets instead (the *runtime* ones) has no effect on the Vite build and will silently ship a client pointing nowhere. Redeploying is required after changing a build variable.

## Deploying (`api` on Railway, `client` on Cloudflare Workers with static assets)

`api` and `client` each live in their own Railway/Cloudflare project, both pointed at the `apps/api` / `apps/client` subfolder of this monorepo (Root Directory setting on each platform). See `apps/api/railway.toml` for the API's config-as-code, and `apps/client/wrangler.jsonc` for the client's.

Note this is Cloudflare **Workers** with static assets, not the classic Cloudflare **Pages** product — Cloudflare's current recommended path for static sites, and what new projects get by default now. The two are configured differently: `apps/client/wrangler.jsonc` sets `assets.not_found_handling` to `single-page-application`, which is what gives the SPA fallback that `react-router-dom`'s `createBrowserRouter` needs (serves `index.html` with a 200 for any path that doesn't match a real asset) — without it, refreshing on any route other than `/` 404s. This replaces the `_redirects`-file approach Pages used; a plain `/* /index.html 200` rule in a `_redirects` file is rejected by Workers static assets as an infinite-loop redirect, since it conflicts with this built-in SPA handling.

**`api` on Railway** — set these in the service's Variables tab:

```bash
NODE_ENV=production
# PORT is provided by Railway automatically — don't set it manually.
DATABASE_HOST=${{Postgres.PGHOST}}
DATABASE_PORT=${{Postgres.PGPORT}}
DATABASE_USER=${{Postgres.PGUSER}}
DATABASE_PASSWORD=${{Postgres.PGPASSWORD}}
DATABASE_NAME=${{Postgres.PGDATABASE}}
JWT_SECRET=<generate with `openssl rand -hex 64` — do not reuse the local dev value>
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d
OVERDUE_REMINDER_CRON=0 9 * * 1,3,5
UPCOMING_DUE_REMINDER_CRON=0 8 * * *
UPCOMING_DUE_REMINDER_DAYS=5
ACCOUNT_SUMMARY_REMINDER_CRON=0 8 1 * *
NEW_LOAN_REMINDER_CRON=0 10 * * 1
CLIENT_URL=<the Cloudflare Workers production URL for this project, e.g. https://collectify.<subdomain>.workers.dev>
# META_WHATSAPP_* — see "On the pending Meta Cloud API credentials" above.
# CLOUDINARY_* — see "Cloudinary uploads are signed by the api" above.
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

`apps/api/railway.toml` sets the build command (`npm run build`), start command (`npm run migration:run && npm run start:prod` — runs pending migrations before every start), and healthcheck path (`/api/v1/health`, already public via `@Public()`).

**`client` on Cloudflare Workers** — build command `npm run build`, deploy command `npx wrangler deploy`, root directory `apps/client`. Set these as **build variables** on the Workers Build trigger (Worker → Settings → Builds → your trigger → Build variables and secrets — see the note above, these are build-time only, not the runtime Variables & Secrets section):

```bash
VITE_API_URL=<the Railway public domain for the api service>/api/v1
```

There's a **circular dependency the first time you deploy both**: the API needs `CLIENT_URL` to know the Workers domain, and the client needs `VITE_API_URL` to know the Railway domain. Deploy the API first with a placeholder `CLIENT_URL` (or Railway's own domain), get the client's assigned `*.workers.dev` domain, update `CLIENT_URL` on Railway, then deploy the client with the real `VITE_API_URL`.

## Related documents

- `README.md` — initial local setup steps that reference this file
- `DATABASE.md` — database configuration these variables connect to
- `DEFINITION_OF_DONE.md` — requirement to update this file when adding new variables
