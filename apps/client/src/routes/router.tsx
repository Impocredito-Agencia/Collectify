import { createBrowserRouter } from 'react-router-dom';

import { AppLayout } from '@/components/layout/AppLayout';
import { AuditLogsPage } from '@/features/auditLogs/AuditLogsPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { RequirePermission } from '@/features/auth/RequirePermission';
import { RequireRole } from '@/features/auth/RequireRole';
import { ClientDetailPage } from '@/features/clients/ClientDetailPage';
import { ClientsListPage } from '@/features/clients/ClientsListPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { InterestConceptTypesPage } from '@/features/interestConceptTypes/InterestConceptTypesPage';
import { LoanDetailPage } from '@/features/loans/LoanDetailPage';
import { LoanQuotePage } from '@/features/loans/LoanQuotePage';
import { LoansListPage } from '@/features/loans/LoansListPage';
import { MessageLogsPage } from '@/features/messageLogs/MessageLogsPage';
import { MessageTemplatesPage } from '@/features/messageTemplates/MessageTemplatesPage';
import { UserDetailPage } from '@/features/users/UserDetailPage';
import { UsersListPage } from '@/features/users/UsersListPage';
import { UsuryRatesPage } from '@/features/usuryRates/UsuryRatesPage';
import { WhatsappInboundMessagesPage } from '@/features/whatsappInboundMessages/WhatsappInboundMessagesPage';

// Grows with each phase: Phase 4+ add one route block per feature, nesting
// RequireRole where a route is admin-only. See docs/phasesClient.
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          {
            // Landing page after login for both roles — the backend has no
            // per-collector data scoping, so there's only one Dashboard, not
            // an admin/cobrador variant. Was HealthCheckPage (Phase 1
            // placeholder) until Phase 7. See DESIGN_TOKENS.md.
            index: true,
            element: <DashboardPage />,
          },
          {
            path: 'clientes',
            element: <ClientsListPage />,
          },
          {
            path: 'clientes/:id',
            element: <ClientDetailPage />,
          },
          {
            path: 'prestamos',
            element: <LoansListPage />,
          },
          {
            path: 'prestamos/:id',
            element: <LoanDetailPage />,
          },
          {
            // No admin/module gate — deliberately open to every
            // authenticated user, confirmed with the human (2026-08-18):
            // this is a stateless calculator that touches no client data
            // and persists nothing, so it carries none of the risk "Crear
            // préstamo" does. See
            // docs/phasesClient/PHASE_14_INTEREST_CONCEPTS.md.
            path: 'cotizador',
            element: <LoanQuotePage />,
          },
          {
            path: 'mensajes',
            element: <MessageLogsPage />,
          },
          {
            // Not in the original 5-phase nav — reachable from the
            // Sidebar's user footer block, not a MENÚ item, matching the
            // client's "Mi perfil" design (no sidebar entry for it there
            // either).
            path: 'perfil',
            element: <ProfilePage />,
          },
          {
            // MessageTemplatesController migrated to Phase 20's module
            // permissions (@RequireModule(AppModule.MessageTemplates)) —
            // gated here the same way, not by role, so client and server
            // never drift apart for this one module. See
            // RequirePermission.tsx and
            // docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
            element: <RequirePermission module="message_templates" />,
            children: [
              {
                path: 'plantillas',
                element: <MessageTemplatesPage />,
              },
            ],
          },
          {
            // InterestConceptTypesController migrated to Phase 20's module
            // permissions (@RequireModule(AppModule.InterestConceptTypes))
            // as part of Phase 23 — gated here the same way, not by role,
            // so client and server never drift apart for this module. See
            // docs/phases/PHASE_23_DYNAMIC_CHARGES.md.
            element: <RequirePermission module="interest_concept_types" />,
            children: [
              {
                path: 'cargos-adicionales',
                element: <InterestConceptTypesPage />,
              },
            ],
          },
          {
            // AuditLogController migrated to Phase 20's module permissions
            // (@RequireModule(AppModule.AuditLog)) — gated here the same
            // way, not by role, so client and server never drift apart for
            // this module. See docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
            element: <RequirePermission module="audit_log" />,
            children: [
              {
                path: 'auditoria',
                element: <AuditLogsPage />,
              },
            ],
          },
          {
            // UsuryRatesController migrated to Phase 20's module permissions
            // (@RequireModule(AppModule.UsuryRates)) — see
            // docs/phases/PHASE_15_USURY_RATE.md and
            // docs/phases/PHASE_20_MODULE_PERMISSIONS.md.
            element: <RequirePermission module="usury_rates" />,
            children: [
              {
                path: 'tasa-de-usura',
                element: <UsuryRatesPage />,
              },
            ],
          },
          {
            // WhatsappController migrated to Phase 20's module permissions,
            // folded into the "messages" module (@RequireModule(AppModule.
            // Messages)) — see docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md
            // and docs/phases/PHASE_20_MODULE_PERMISSIONS.md. Read-only "not
            // blocked" floor: no button-flow/menu management or preference
            // UI here — those are blocked on open questions.
            element: <RequirePermission module="messages" />,
            children: [
              {
                path: 'mensajes-entrantes',
                element: <WhatsappInboundMessagesPage />,
              },
            ],
          },
          {
            // UsersController stays admin-only server-side
            // (@Roles(UserRole.Admin)) — deliberately never migrated to
            // module permissions, per the human's explicit exception
            // (Phase 20): account management (creating accounts, deleting/
            // editing other collector profiles, changing anyone's role to
            // admin) always requires the admin role itself, not a grantable
            // module. See docs/phases/PHASE_20_MODULE_PERMISSIONS.md and
            // docs/phasesClient/PHASE_19_USER_MANAGEMENT.md.
            element: <RequireRole allowedRoles={['admin']} />,
            children: [
              {
                path: 'usuarios',
                element: <UsersListPage />,
              },
              {
                // "Ver perfil" (Phase 20 follow-up) — read-only, same
                // admin-only guard as the list itself. See
                // UserDetailPage.tsx.
                path: 'usuarios/:id',
                element: <UserDetailPage />,
              },
            ],
          },
        ],
      },
    ],
  },
]);
