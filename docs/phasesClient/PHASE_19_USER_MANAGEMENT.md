# Phase 19 — User Management UI (Client)

## Goal

Build the admin panel for managing company (collector/admin) user accounts — creating them, deactivating, and reactivating — that has never had a frontend despite the backend supporting it fully since Phase 2. This resolves the "User management UI" item listed as candidate scope in `docs/phasesClient/PHASE_8_POLISH.md`; that document is not being rewritten, this phase formally picks up that item. Mirrors `docs/phases/PHASE_19_USER_MANAGEMENT.md`.

## Required reading before starting

`docs/phases/PHASE_19_USER_MANAGEMENT.md` (the `api` counterpart, confirming the backend is ready), `docs/phasesClient/PHASE_8_POLISH.md` (where this item originates).

## Scope

### Data layer
- [x] `usersApi.ts` — `getAll(query)`, `getById(id)` (Phase 20 follow-up), `create(dto)`, `deactivate(id)`, `reactivate(id)`, `remove(id)` (Phase 20 follow-up), matching the existing `UsersController` endpoints.
- [x] `useUsers.ts` hooks (TanStack Query), mirroring `useClients.ts`.

### Pages and components
- [x] `features/users/UsersListPage.tsx` — list with Activos/Inactivos tabs, closely mirroring `ClientsListPage.tsx`. No search or pagination controls: `QueryUsersDto` only supports `isActive`, and a company user list is expected to stay small.
- [x] `UserForm.tsx` — create dialog (name, email, role, password), mirroring `ClientForm.tsx`'s structure. Create-only, unlike `ClientForm.tsx` — the backend has no `PATCH /users/:id` to edit an existing account, only deactivate/reactivate/delete.
- [x] `UserRow.tsx` — deactivate/reactivate row actions, mirroring `ClientRow.tsx`. The logged-in admin's own row shows "Tu cuenta" instead of a Desactivar action (client-side mirror of `UsersService.deactivate`'s server-side "cannot deactivate your own account" rule, avoiding a guaranteed-400 request). A confirm dialog (`DeactivateUserDialog.tsx`, mirroring `DeactivateClientDialog.tsx`) gates the actual deactivation.
- [x] New route `/usuarios`, `RequireRole allowedRoles={['admin']}`, same pattern as `/plantillas`.
- [x] Sidebar nav entry ("Usuarios"), admin only.
- [x] **Phase 20 follow-up (2026-09-03) — permanent delete for a deactivated account.** Confirmed with the human: "eliminar" here means a real, irreversible `DELETE` (not the soft-delete `deletedAt` column already sitting unused on the `User` entity) — a genuine second step past deactivation, admin only, only allowed once the account is already deactivated (`UsersService.remove` 400s otherwise). Safe to hard-delete: `audit_logs.actorUserId` and `usury_rates.createdBy` both use `onDelete: 'SET NULL'`, so this account's past actions stay in those trails with no resolvable actor rather than disappearing with it; `user_module_permissions` rows cascade-delete, which is fine — they're just this account's own grants. `UserRow.tsx`'s "Eliminar" action only shows on an already-inactive row, gated by a `DeleteUserDialog.tsx` (mirrors `DeleteLoanDialog.tsx`'s confirm-with-inline-error pattern, worded to make the irreversibility explicit).
- [x] **Phase 20 follow-up (2026-09-03) — "Ver perfil" (read-only detail view).** The client flagged that the only way to see an account's own details was clicking your own name in the Sidebar footer (`ProfilePage.tsx`, self only) — there was no way to inspect another user's account from the Usuarios list at all. Added `GET /users/:id` (admin only, read-only — no `PATCH /users/:id` exists, so this doesn't open any new edit surface) and `UserDetailPage.tsx` (`/usuarios/:id`), reachable via a new "Ver perfil" `RowActionButton` on every `UserRow.tsx` row, active or not. Mirrors `ProfilePage.tsx`'s "Información de cuenta" card (name, correo, rol, desde) plus a módulos card, minus `ChangePasswordCard` (that only makes sense for your own account). Confirmed with the human: both this page's back link and `ProfilePage.tsx`'s "Cancelar" (see next item) use `navigate(-1)` (browser history) rather than a fixed route, so they always return to whatever screen — Usuarios, Auditoría, Envíos fallidos, wherever — the admin actually came from.
- [x] **Bug fix (2026-09-03) — "Cancelar" in Cambiar contraseña did nothing.** `ChangePasswordCard` (`features/auth/ChangePasswordDialog.tsx`, rendered inside `ProfilePage.tsx`) is an embedded card, not a modal — its "Cancelar" only ever called `resetFields()`, which is invisible on an untouched form, reported by the client as the button "doing nothing when pressed". Fixed to `navigate(-1)` instead, per the human's explicit answer — see the "Ver perfil" item above for the shared reasoning.

## Definition of done for this phase

- [x] An admin can create, deactivate, reactivate, and permanently delete a deactivated collector/admin account entirely through the panel, with no direct API access needed.
- [x] All items in `docs/DEFINITION_OF_DONE.md` checklist pass.

## Related documents

- `docs/phases/PHASE_19_USER_MANAGEMENT.md` — the `api` counterpart
- `docs/phasesClient/PHASE_8_POLISH.md` — where this item was originally deferred
- `docs/phasesClient/PHASE_20_MODULE_PERMISSIONS.md` — the follow-up phase that adds granular permissions on top of this panel
