# Environment Variables

This document explains every environment variable used across `api` and `client`, what it's for, and where to get its value.

## Environments

Currently the project runs in three contexts:

- **Local development** — your machine, using the `.env` file, with PostgreSQL running via Docker.
- **Production** — `api` on Railway, `client` on Cloudflare Pages, per the original Phase 1 plan. Variables are set through each platform's dashboard, never committed to the repo. See "Deploying" below for the full walkthrough.

There's no separate staging environment right now — Vercel was used for that early on but is no longer part of the setup (staging's own Postgres plugin was separate from production's, so nothing from it carries over). Cloudflare Pages gives an automatic **Preview deployment** per branch/PR out of the box, which can stand in for manual QA on the `client` side when needed; there's no equivalent yet on the `api` side.

## General rules

- **Never commit a `.env` file.** It's listed in `.gitignore` for exactly this reason.
- **Every variable must exist in `.env.example`**, with a placeholder or dummy value — this is how a new developer knows what to fill in.
- If you add a new environment variable, update `.env.example` **and** this document in the same Pull Request (see `DEFINITION_OF_DONE.md`).
- Production values are set directly in Railway's / Cloudflare Pages' environment variable settings — never sent over Slack, WhatsApp, or committed anywhere.

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

# ── Scheduled jobs ──────────────────────────────────────
OVERDUE_REMINDER_CRON=0 9 * * 1,3,5
UPCOMING_DUE_REMINDER_CRON=0 8 * * *
UPCOMING_DUE_REMINDER_DAYS=5,3,1
ACCOUNT_SUMMARY_REMINDER_CRON=0 8 1 * *

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
| `OVERDUE_REMINDER_CRON` | ✅ | Cron expression controlling when the overdue reminder job runs. Default `0 9 * * 1,3,5` = every Monday, Wednesday, and Friday at 9:00 AM. Changed from a single weekly run (Monday only) at the client's request — the message content is still one consolidated summary per client, it's just sent three times a week instead of once. |
| `UPCOMING_DUE_REMINDER_CRON` | ✅ | Cron expression controlling when the daily upcoming-due ("Aviso") reminder job runs. Default `0 8 * * *` = every day at 8:00 AM. Added in Phase 9 — see `docs/phases/PHASE_9_MESSAGE_TYPES.md`. |
| `UPCOMING_DUE_REMINDER_DAYS` | ✅ | Comma-separated list of day thresholds before an installment's due date to send the "Aviso" reminder. Default `5,3,1`. Added in Phase 9. |
| `ACCOUNT_SUMMARY_REMINDER_CRON` | ✅ | Cron expression for the account-summary cron (Phase 18) — sends to every client with at least one active loan (corrected after client QA, 2026-08-18; originally audience-only). Default `0 8 1 * *` = 8:00 AM on the 1st of each month. Admin-editable via `MessageTemplate.cronExpression`, which takes precedence over this code default when set — see `docs/phases/PHASE_18_MESSAGE_AUDIENCES.md`. `new_loan` has no cron variable at all — it's sent synchronously at loan creation only, with no periodic job. |
| `CLIENT_URL` | ✅ | The client's URL, used to configure CORS. `http://localhost:5173` locally; the Cloudflare Pages URL in production. |

### On the pending Meta Cloud API credentials

Since the client hasn't finished setting up their Meta Business account yet, the `WhatsAppService` should be built to **fail gracefully** when these variables are empty — logging a warning and skipping the actual API call — rather than crashing the whole application on startup. This lets development continue on every other module without being blocked. Once the client provides these values, they get added to Railway's production environment variables (and to a developer's local `.env` for testing against the real API).

---

## Client (`apps/client/.env.local`)

Vite only exposes variables prefixed with `VITE_` to the frontend code — this is a security measure so that server-only secrets are never accidentally bundled into the browser build.

```bash
VITE_API_URL=http://localhost:3000/api/v1

# ── Payment receipt photos — Cloudinary (Phase 12) ─────
VITE_CLOUDINARY_CLOUD_NAME=
VITE_CLOUDINARY_UPLOAD_PRESET=
```

### Variable reference

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | ✅ | Base URL the client uses to reach the API. Points to `localhost:3000` locally; points to the Railway-deployed API URL in production. |
| `VITE_CLOUDINARY_CLOUD_NAME` | ⚠️ Pending | Cloudinary's cloud name, used to build the upload endpoint URL (`https://api.cloudinary.com/v1_1/<cloud_name>/image/upload`). Public value, not a secret — found on the Cloudinary dashboard. **Not yet available — no Cloudinary account has been created for this project yet.** See `docs/phases/PHASE_12_PAYMENT_ATTACHMENTS.md` for the provider comparison and recommendation. |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | ⚠️ Pending | Name of an **unsigned** upload preset configured in the Cloudinary dashboard (Settings → Upload). Unsigned, not signed, because a signed upload needs an api key/secret pair that can't safely live in client-side code — see `lib/imageUpload.ts`. Same pending status as above. |

Accessed in code as:

```typescript
const apiUrl = import.meta.env.VITE_API_URL;
```

### On the pending Cloudinary credentials

Unlike the pending Meta WhatsApp credentials (which the `api` handles by logging and skipping a background cron job), a missing Cloudinary config has no reasonable "skip silently" behavior here — registering a payment with a photo is a direct, in-the-moment user action, not a scheduled job. `lib/imageUpload.ts` throws a clear `ImageUploadError` instead, which `RegisterPaymentDialog.tsx` surfaces as a blocking error message rather than letting the payment submit without the photo. Registering a payment with **no** photo at all is unaffected either way — the field is optional end to end.

---

## Setting variables in production

- **Railway (`api`)**: Project → Variables tab. When a PostgreSQL plugin is attached to the same Railway project, reference its values instead of hardcoding them — e.g. set `DATABASE_HOST` to `${{Postgres.PGHOST}}`, `DATABASE_PORT` to `${{Postgres.PGPORT}}`, and so on for `DATABASE_USER`/`DATABASE_PASSWORD`/`DATABASE_NAME` against `PGUSER`/`PGPASSWORD`/`PGDATABASE`. This keeps the API in sync automatically if the plugin ever rotates credentials.
- **Cloudflare Pages (`client`)**: Project → Settings → Environment Variables. Remember `client` variables are baked into the build at build time, not read at runtime — redeploying is required after changing one.

## Deploying (`api` on Railway, `client` on Cloudflare Pages)

`api` and `client` each live in their own Railway/Cloudflare Pages project, both pointed at the `apps/api` / `apps/client` subfolder of this monorepo (Root Directory setting on each platform). See `apps/api/railway.toml` for the API's config-as-code; `apps/client/public/_redirects` gives Cloudflare Pages the SPA fallback (`/*` → `/index.html`) that `react-router-dom`'s `createBrowserRouter` needs — without it, refreshing on any route other than `/` 404s.

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
UPCOMING_DUE_REMINDER_DAYS=5,3,1
ACCOUNT_SUMMARY_REMINDER_CRON=0 8 1 * *
CLIENT_URL=<the Cloudflare Pages production URL for this project, e.g. https://collectify.pages.dev>
# META_WHATSAPP_* — see "On the pending Meta Cloud API credentials" above.
```

`apps/api/railway.toml` sets the build command (`npm run build`), start command (`npm run migration:run && npm run start:prod` — runs pending migrations before every start), and healthcheck path (`/api/v1/health`, already public via `@Public()`).

**`client` on Cloudflare Pages** — set these in Project → Settings → Environment Variables (Production):

```bash
VITE_API_URL=<the Railway public domain for the api service>/api/v1
VITE_CLOUDINARY_CLOUD_NAME=
VITE_CLOUDINARY_UPLOAD_PRESET=
```

There's a **circular dependency the first time you deploy both**: the API needs `CLIENT_URL` to know the Cloudflare Pages domain, and the client needs `VITE_API_URL` to know the Railway domain. Deploy the API first with a placeholder `CLIENT_URL` (or Railway's own domain), get Cloudflare Pages' assigned domain, update `CLIENT_URL` on Railway, then deploy the client with the real `VITE_API_URL`.

## Related documents

- `README.md` — initial local setup steps that reference this file
- `DATABASE.md` — database configuration these variables connect to
- `DEFINITION_OF_DONE.md` — requirement to update this file when adding new variables
