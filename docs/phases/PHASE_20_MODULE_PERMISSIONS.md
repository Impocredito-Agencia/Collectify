# Phase 20 — Module Permissions Matrix

## Goal

Go beyond the current binary `admin`/`collector` role to let an admin control, per employee, which modules of the panel they can see and use. This is the second, larger half of item 17 in the original request ("activar o desactivar los módulos que pueden o no ver los empleados") — split from `docs/phases/PHASE_19_USER_MANAGEMENT.md` because this half is an architecture change touching every protected endpoint, not just a UI addition on top of an already-complete backend.

## Before starting this phase — stop and confirm with the human

1. What exactly is a "módulo"? A fixed enum of app sections (Clientes, Préstamos, Mensajes, Plantillas, Auditoría, etc. — matching the sidebar's top-level items), or something more granular by route/action?
2. Are permissions assigned per individual user, per role with per-user exceptions, or purely per role (in which case this is really "more roles", not a permissions matrix)?

**Do not pick answers and build it — ask the human.** This changes the global `RolesGuard` used by every protected controller in the system — a wrong design here has to be unwound across the entire API surface, not just one module.

**Confirmed with the human (2026-08-18):**
1. A "módulo" is a fixed enum of 8 sections matching the sidebar's top-level items exactly — `clients`, `loans`, `messages`, `message_templates`, `interest_concept_types`, `audit_log`, `usury_rates`, `users`. No finer-grained view/edit split. Dashboard and Perfil are excluded — neither is ever restricted.
2. Permissions are per individual user, not per role. There's no `can_view` boolean either — a `UserModulePermission` row's mere presence is the grant. Additionally decided during implementation (a direct, low-risk consequence of these two answers, not a separate open question): an admin has full system access unconditionally, always — `ModulePermissionsGuard` never even queries this table for one, matching the pre-existing "Owner (Admin): Full system access" line already in `docs/GLOSSARY.md`. Only a collector's access is actually gated by these rows.

## Required reading before starting

`docs/ARCHITECTURE.md` (current `RolesGuard`/`@Roles()` mechanism), `docs/phases/PHASE_2_AUTH.md` (where the current binary role system was built), `docs/phases/PHASE_19_USER_MANAGEMENT.md` (the user management panel this phase's permissions attach to).

## Scope

### Entities and migrations
- [x] `UserModulePermission` entity — `id`, `user_id` (FK, cascade delete), `module` (enum), `created_at`. Unique on (`user_id`, `module`). No boolean column — see above.
- [x] `CreateUserModulePermissionsTable` migration — also seeds `clients`/`loans`/`messages` for every collector that existed at the time (the 3 modules that were never behind `@Roles(UserRole.Admin)`), so this migration ships with zero behavior change for any existing account.

### Guard and enforcement
- [x] `ModulePermissionsGuard` — globally registered alongside (not instead of) the existing `RolesGuard`. No-ops when a handler has no `@RequireModule()` metadata, so an un-migrated controller is completely unaffected. Always allows an admin.
- [x] `@RequireModule(AppModule.X)` decorator, parallel to `@Roles()`.
- [x] **`MessageTemplatesController` migrated** — the low-risk controller this doc originally suggested starting with. `@Roles(UserRole.Admin)` replaced with `@RequireModule(AppModule.MessageTemplates)`.
- [x] **InterestConceptTypesController migrated** — done as part of Phase 23's dynamic-charges work, ahead of this doc catching up (`@RequireModule(AppModule.InterestConceptTypes)`).
- [x] **All remaining controllers migrated** (`feature/fase20-completar-permisos`, 2026-09-03): `ClientsController` (10 endpoints, all to `clients`), `LoansController` (4 remaining endpoints — update/payoff/refinance/remove — to `loans`; `create` had already migrated in Phase 23), `MessageLogsController.retry` (to `messages`), `AuditLogController` (to `audit_log`), `UsuryRatesController` (to `usury_rates`), `WhatsappController` (class-level decorator, all 10 endpoints, folded into `messages` per the human's decision), `ClientLoanImportController` (to `clients`, per the human's decision). Each swapped `@Roles(UserRole.Admin)` for `@RequireModule()`, updated its Swagger summaries, and had its matching route gate (`RequireRole` → `RequirePermission` in `router.tsx`) and `Sidebar.tsx` nav entry updated on the client.
- [x] **`UsersController` deliberately stays on `@Roles(UserRole.Admin)`** — not a migration gap, a confirmed permanent exception (see "Before starting this phase" above): account management (create account, list/deactivate/reactivate/delete users, `PUT :id/permissions`) always requires the admin role itself, never a grantable module. `RequireRole allowedRoles={['admin']}` and Sidebar's `roles: ['admin']` stay on the `/usuarios` route/nav entry for the same reason.
- [x] **New in this branch: `DELETE /users/:id`** (permanent deletion of an already-deactivated account) — same `@Roles(UserRole.Admin)` treatment as the rest of `UsersController`. See `docs/phasesClient/PHASE_19_USER_MANAGEMENT.md`'s "Phase 20 follow-up" entry for the full writeup (confirmed hard-delete vs. soft-delete decision, FK safety, frontend flow).
- [x] **New in this branch: `GET /users/:id`** (read-only single-user lookup, backing the client's "Ver perfil" action) — same `@Roles(UserRole.Admin)` treatment as the rest of `UsersController`; `UsersService.findOne` throws `NotFoundException` for a missing id, same as every other single-user method here. No `PATCH /users/:id` was added alongside it — this stays read-only. See `docs/phasesClient/PHASE_19_USER_MANAGEMENT.md`'s "Ver perfil" entry for the frontend side.

**Confirmed consequence of this migration, flagged and accepted by the human (2026-09-03):** the original `CreateUserModulePermissionsTable` migration (see "Entities and migrations" above) auto-seeded `clients`/`loans`/`messages` for every collector that existed at the time, back when those 3 controllers were still unmigrated and those modules effectively meant "view only" (plus "create a loan", migrated in Phase 23). Now that `ClientsController`, the rest of `LoansController`, and `WhatsappController` are fully migrated, every existing collector holding one of those auto-seeded rows immediately gains full management access to that module — edit/deactivate clients, edit/payoff/refinance/delete loans, full WhatsApp control — not just what they could do before. This is the direct, intended consequence of the confirmed "no finer-grained view/edit split, row presence = full module access" design (see "Before starting this phase" above), not a bug. The human chose not to pre-emptively narrow or wipe existing collectors' seeded grants — an admin can review and revoke per-module access for any collector from the Usuarios panel at any time, same as any future grant.

### Tests (mandatory)
- [x] `ModulePermissionsGuard` covered directly: no metadata → passes through untouched; admin → always allowed regardless of granted modules; collector with the required module → allowed; collector without it → rejected; no user → rejected.
- [x] `UserModulePermissionsService` covered: get/batch-get modules, replace-all (including de-duplication and the empty-set case), 404 for a missing user.
- [x] `UsersService.setModulePermissions` covered: happy path, rejects for an admin account, 404 for a missing user. `findAll`/`create` updated to assert the attached `modules` field.
- [x] Migrating `MessageTemplatesController` alone doesn't change behavior elsewhere: `ModulePermissionsGuard` is a strict no-op without `@RequireModule()` metadata, and `RolesGuard` itself was never modified — the safest possible guarantee that every other controller's behavior is byte-for-byte unchanged.

### Swagger
- [x] `MessageTemplatesController`'s existing `(admin only)` summaries updated to `(admin or granted the message_templates module)`.
- [x] New `PUT /users/:id/permissions` endpoint fully documented (still `@Roles(UserRole.Admin)` — only an admin can grant/revoke, unrelated to which controllers have migrated).

## Definition of done for this phase

- [x] An admin can control, per employee, which modules they can access — via the new checklist in the user management panel.
- [x] The confirmed permission model is implemented exactly as agreed — not guessed.
- [x] Every previously `@Roles()`-protected endpoint that was meant to migrate has been migrated — see "Guard and enforcement" above. `UsersController` is the one confirmed, permanent exception, not an oversight.
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass for the work actually shipped in this round.

## After this phase

- [x] `docs/GLOSSARY.md`'s "Roles" section updated — the "exact permission boundaries to be finalized during development" note on Collector/Cobrador is resolved, and a new "Module permission" entry added.
- [x] `docs/DATABASE.md` updated with the new `user_module_permissions` table.

## Related documents

- `docs/phases/PHASE_2_AUTH.md` — the binary role system this phase extends
- `docs/phases/PHASE_19_USER_MANAGEMENT.md` — the panel this phase's permissions attach to
- `docs/GLOSSARY.md` — the "Roles"/"Module permission" entries this phase resolved
