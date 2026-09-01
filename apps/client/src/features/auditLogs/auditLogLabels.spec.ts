import { describe, expect, it } from 'vitest';

import {
  ACTION_LABELS,
  ENTITY_TYPE_LABELS,
  formatAuditAction,
  formatAuditEntityType,
} from './auditLogLabels';

// Phase 32 — the "raw unreadable code" the client reported in the audit
// log's "ver detalle" view was this map falling out of sync with newer
// @Audit() calls added by Phases 8/20/27/28/30 (e.g. "loan.delete" shown
// verbatim instead of "Eliminó un préstamo"). These tests pin down the
// actions/entityTypes that must stay labeled — see
// docs/phases/PHASE_32_UI_FIXES.md.
describe('formatAuditAction', () => {
  it('translates every action added by a later phase that previously fell through unlabeled', () => {
    expect(formatAuditAction('loan.delete')).toBe('Eliminó un préstamo');
    expect(formatAuditAction('payment.registerBulk')).toBe(
      'Registró un pago sobre varias cuotas',
    );
    expect(formatAuditAction('user.updatePermissions')).toBe(
      'Actualizó los permisos de un usuario',
    );
    expect(formatAuditAction('client.setMessageFrequency')).toBe(
      'Configuró la frecuencia de mensajes de un cliente',
    );
    expect(formatAuditAction('client.clearMessageFrequency')).toBe(
      'Quitó la frecuencia personalizada de un cliente',
    );
    expect(formatAuditAction('clientLoanImport.execute')).toBe(
      'Importó clientes y préstamos desde Excel',
    );
  });

  it('still falls back to the raw action string when no label exists yet', () => {
    expect(formatAuditAction('unknownEntity.doSomething')).toBe(
      'unknownEntity.doSomething',
    );
  });

  it('has no gaps left between this map and the previously-known labeled actions', () => {
    // Guards against the exact bug this phase fixed re-occurring silently —
    // every action already covered before Phase 32 must still resolve to
    // something other than its own raw key.
    const previouslyLabeled = [
      'client.create',
      'client.update',
      'client.deactivate',
      'client.reactivate',
      'client.addReference',
      'client.updateReference',
      'client.removeReference',
      'loan.create',
      'loan.update',
      'loan.payoff',
      'loan.refinance',
      'payment.register',
      'user.create',
      'user.deactivate',
      'user.reactivate',
      'usuryRate.create',
    ];
    for (const action of previouslyLabeled) {
      expect(ACTION_LABELS[action]).toBeDefined();
    }
  });
});

describe('formatAuditEntityType', () => {
  it('translates clientLoanImport, the entityType that previously fell through unlabeled', () => {
    expect(formatAuditEntityType('clientLoanImport')).toBe(
      'Importación de clientes',
    );
  });

  it('still falls back to the raw entityType when no label exists yet', () => {
    expect(formatAuditEntityType('somethingNew')).toBe('somethingNew');
  });

  it('keeps every previously-known entityType labeled', () => {
    const previouslyLabeled = [
      'client',
      'loan',
      'payment',
      'user',
      'usuryRate',
    ];
    for (const entityType of previouslyLabeled) {
      expect(ENTITY_TYPE_LABELS[entityType]).toBeDefined();
    }
  });
});
