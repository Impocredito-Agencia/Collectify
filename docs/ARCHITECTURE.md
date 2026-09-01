# Architecture

This document describes how the codebase is organized and the key design decisions behind it. If you're new to the project, read this before writing any code.

## Overview

Collectify is a monorepo with two independent applications that communicate over HTTP:

```
collectify/
├── apps/
│   ├── api/       # NestJS REST API — business logic, database, WhatsApp integration
│   └── client/    # React + Vite SPA — admin panel consumed by Owner and Collector roles
└── docs/          # This documentation
```

The `api` and `client` are deployed independently (`api` on Railway, `client` on Cloudflare Workers with static assets) and can be developed, tested, and released independently. The only contract between them is the REST API defined by `api`.

---

## API — NestJS

### Module-per-domain organization

The API is organized by **business domain**, not by technical layer. Each domain owns its controllers, services, entities, and DTOs in a single folder. This makes it obvious where to find or add code for a given feature, and keeps related code together instead of scattered across `controllers/`, `services/`, `entities/` top-level folders.

```
apps/api/
└── src/
    ├── auth/
    │   ├── auth.controller.ts
    │   ├── auth.service.ts
    │   ├── auth.module.ts
    │   ├── guards/
    │   │   └── jwtAuth.guard.ts
    │   ├── decorators/
    │   │   └── roles.decorator.ts
    │   └── dto/
    │       ├── login.dto.ts
    │       └── refreshToken.dto.ts
    │
    ├── clients/
    │   ├── clients.controller.ts
    │   ├── clients.service.ts
    │   ├── clients.service.spec.ts
    │   ├── clients.module.ts
    │   ├── entities/
    │   │   └── client.entity.ts
    │   └── dto/
    │       ├── createClient.dto.ts
    │       └── updateClient.dto.ts
    │
    ├── loans/
    │   ├── loans.controller.ts
    │   ├── loans.service.ts
    │   ├── loans.service.spec.ts
    │   ├── loans.module.ts
    │   ├── installments/
    │   │   ├── installments.controller.ts
    │   │   ├── installments.service.ts
    │   │   └── installments.service.spec.ts
    │   ├── entities/
    │   │   ├── loan.entity.ts
    │   │   ├── installment.entity.ts
    │   │   └── payment.entity.ts
    │   └── dto/
    │
    ├── whatsapp/
    │   ├── whatsapp.service.ts        # wraps Meta Cloud API calls
    │   ├── whatsapp.service.spec.ts
    │   ├── whatsapp.module.ts
    │   ├── messageTemplates/
    │   │   ├── messageTemplates.controller.ts
    │   │   └── messageTemplates.service.ts
    │   ├── webhook/                   # Phase 22 — inbound events, the one
    │   │   │                          # @Public() exception in this module
    │   │   ├── whatsappWebhook.controller.ts
    │   │   ├── whatsappWebhook.service.ts
    │   │   ├── whatsappInbound.gateway.ts  # live push — see "WebSocket gateways" below
    │   │   └── extractInboundEvents.ts, normalizeIncomingPhoneNumber.ts
    │   ├── entities/
    │   │   ├── messageLog.entity.ts
    │   │   ├── messageLogItem.entity.ts
    │   │   ├── messageTemplate.entity.ts
    │   │   └── whatsappInboundMessage.entity.ts
    │   └── overdueReminder.cron.ts    # weekly scheduled job — see note below
    │
    ├── dashboard/
    │   ├── dashboard.controller.ts
    │   └── dashboard.service.ts
    │
    ├── common/                         # shared across modules
    │   ├── filters/
    │   │   └── httpException.filter.ts
    │   ├── interceptors/
    │   │   └── response.interceptor.ts
    │   ├── adapters/
    │   │   └── socketIo.adapter.ts      # WebSocket CORS — see note below
    │   ├── decorators/
    │   └── pipes/
    │
    ├── config/
    │   └── configuration.ts            # env var validation and typed config
    │
    ├── app.module.ts
    └── main.ts
```

### Layering within each module

Each domain module follows the standard NestJS request flow:

```
Controller → Service → Repository (TypeORM)
```

- **Controller**: handles HTTP concerns only — routes, request/response shape, status codes, Swagger decorators. No business logic.
- **Service**: owns all business logic — validations, calculations, orchestration. This is the layer covered by unit tests (see `TESTING.md`).
- **Repository**: TypeORM's injected repository for the entity. Services depend on repositories, never on raw SQL or direct database connections.

A controller should never talk to a repository directly — always through a service.

### API versioning

All routes are prefixed with `/api/v1`:

```
GET  /api/v1/clients
POST /api/v1/loans
```

This allows introducing `/api/v2` in the future without breaking existing frontend integrations.

### Response format

All successful responses follow a consistent shape, applied globally via `common/interceptors/response.interceptor.ts`:

```json
{
  "success": true,
  "data": { },
  "meta": { "page": 1, "totalPages": 5 }
}
```

`meta` is only present on paginated list endpoints.

Errors are handled globally via `common/filters/httpException.filter.ts` and follow this shape:

```json
{
  "success": false,
  "message": "Client not found",
  "statusCode": 404
}
```

Services throw NestJS built-in exceptions (`NotFoundException`, `BadRequestException`, `ForbiddenException`, etc.) — the global filter takes care of formatting them consistently. Controllers should never manually construct error responses.

### Scheduled jobs

The weekly overdue-reminder job lives in `whatsapp/overdueReminder.cron.ts`, using `@nestjs/schedule`'s `@Cron()` decorator. It is registered in `whatsapp.module.ts` and can be paused/resumed via the `SchedulerRegistry` API, exposed through an admin-only endpoint.

### WebSocket gateways

Added Phase 22 for the inbound-message inbox's live updates (`whatsapp/webhook/whatsappInbound.gateway.ts`) — the first real-time channel in this API, everything before it was request/response only. `main.ts` installs `common/adapters/socketIo.adapter.ts` globally so every gateway shares the same CORS origin as the REST API (`app.enableCors()`'s `clientUrl`) instead of hardcoding it per-gateway. A gateway is admin-only the same way a controller is, but can't reuse `JwtAuthGuard`/`@Roles()` directly — Socket.IO's handshake never passes through Nest's HTTP guard pipeline — so `WhatsappInboundGateway.handleConnection` verifies the access token and role by hand instead, disconnecting anything that doesn't resolve to an active admin.

**Important — the job groups by client, not by loan or installment.** Confirmed from real business messages: a single client with overdue installments across multiple loans (pagarés) receives **one** consolidated WhatsApp message listing every overdue installment with its own days-overdue and interest, followed by a grand total. The job's logic is roughly:

```
for each client with at least one overdue installment:
    gather all overdue installments across all of that client's active loans
    render the active template with the full list + grand total
    send one message via WhatsAppService
    record one MessageLog + one MessageLogItem per included installment
```

See `DATABASE.md` for the exact entity structure (`message_logs` + `message_log_items`) and `GLOSSARY.md` for the confirmed interest formula applied per installment.

---

## Client — React + Vite

### Why Vite (not Next.js)

This is an internal admin panel with no public-facing pages and no SEO requirement. Vite gives a lighter, faster development setup without the added complexity of SSR, routing conventions, or server components that Next.js brings — none of which this project needs. If a public-facing product (e.g. a future marketplace) is built later, it will likely be a **separate application** with its own SSR-capable framework, rather than retrofitting this admin panel.

### Folder organization — feature-based

```
apps/client/
└── src/
    ├── features/
    │   ├── auth/
    │   │   ├── LoginPage.tsx
    │   │   ├── useAuth.ts
    │   │   └── authApi.ts
    │   │
    │   ├── clients/
    │   │   ├── ClientsListPage.tsx
    │   │   ├── ClientDetailPage.tsx
    │   │   ├── ClientForm.tsx
    │   │   ├── useClients.ts          # React Query hooks
    │   │   └── clientsApi.ts          # raw fetch calls to the API
    │   │
    │   ├── loans/
    │   ├── installments/
    │   ├── whatsapp-messages/
    │   ├── messageTemplates/
    │   └── dashboard/
    │
    ├── components/                     # shared, reusable UI components
    │   ├── ui/                         # buttons, inputs, modals, etc.
    │   └── layout/
    │       ├── Sidebar.tsx
    │       └── Header.tsx
    │
    ├── lib/
    │   ├── apiClient.ts                 # base fetch wrapper (auth headers, base URL, error handling)
    │   ├── queryClient.ts               # TanStack Query client instance
    │   └── socket.ts                    # Socket.IO connection factory — see "WebSocket gateways" above
    │
    ├── routes/
    │   └── router.tsx                   # React Router route definitions
    │
    ├── App.tsx
    └── main.tsx
```

### Data fetching — TanStack Query

All communication with the API goes through **TanStack Query (React Query)**. Each feature defines its own hooks (e.g. `useClients.ts`) wrapping `useQuery`/`useMutation`, instead of calling `fetch` directly inside components.

```typescript
// features/clients/useClients.ts
export function useClients(page: number) {
  return useQuery({
    queryKey: ['clients', page],
    queryFn: () => clientsApi.getAll(page),
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clientsApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });
}
```

This keeps components focused on rendering, and centralizes loading/error/cache handling in one place per feature.

### Routing

**React Router** handles client-side routing. Route protection (redirecting unauthenticated users to `/login`) is implemented as a wrapper component around protected routes, checking the auth state from `features/auth/useAuth.ts`.

### Styling

**Tailwind CSS** utility classes directly in components. No CSS-in-JS, no separate `.css` files per component except for rare global overrides in `index.css`.

---

## Cross-cutting decisions

| Decision | Choice | Why |
|---|---|---|
| API communication | REST, JSON | Simpler than GraphQL for a 2-endpoint-consumer setup; team has more REST experience |
| Auth | JWT (access + refresh token) | Stateless, works well with SPA + separate API |
| ORM | TypeORM | Team has prior experience; mature NestJS integration |
| Messaging | Meta Cloud API | Official WhatsApp Business API, no third-party markup |
| Deployment (API) | Railway | Simple, affordable for current scale |
| Deployment (Client) | Cloudflare Workers (static assets) | Free tier, unlimited bandwidth, ideal for a static SPA build — Cloudflare's current recommended path for static sites, replacing the classic Pages product |

## Architecture Decision Records

For deeper reasoning behind major technology choices (why NestJS over FastAPI, why REST over GraphQL, why Vite over Next.js), see `docs/adr/`. Each significant decision that could reasonably have gone another way should have a short ADR so future developers understand the "why," not just the "what."
