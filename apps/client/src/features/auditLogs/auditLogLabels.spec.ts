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
    expect(formatAuditAction('user.delete')).toBe('Eliminó un usuario');
    // Human report, 2026-09-09 — payment correction feature.
    expect(formatAuditAction('payment.void')).toBe('Anuló un pago');
  });

  // Human report, 2026-09-10 — the Plantillas tab's per-family cron menu
  // (Pausar/Reanudar/Guardar horario) had never been audit-logged at all.
  it('translates every whatsappCron action', () => {
    expect(formatAuditAction('whatsappCron.pause')).toBe(
      'Pausó un recordatorio automático',
    );
    expect(formatAuditAction('whatsappCron.resume')).toBe(
      'Reanudó un recordatorio automático',
    );
    expect(formatAuditAction('whatsappCron.reschedule')).toBe(
      'Cambió el horario de un recordatorio automático',
    );
  });

  // Human report, 2026-09-13 — close-conversation had never been
  // audit-logged either, same coverage sweep as whatsappCron above.
  it('translates whatsappTicket.resolve', () => {
    expect(formatAuditAction('whatsappTicket.resolve')).toBe(
      'Cerró una conversación de WhatsApp',
    );
  });

  // 2026-09-06 — the combined clients+loans Excel importer was split into
  // two endpoints (see apps/api/src/clientsImport and apps/api/src/
  // loanImport), each firing its own @Audit() call under a new action
  // name. This map was never updated for the rename, so Auditoría showed
  // raw "clientsImport.execute" instead of a translated label — caught
  // from a live screenshot.
  it('translates both actions from the 2026-09-06 clients/loans import split', () => {
    expect(formatAuditAction('clientsImport.execute')).toBe(
      'Importó clientes desde Excel',
    );
    expect(formatAuditAction('loanImport.execute')).toBe(
      'Importó préstamos desde Excel',
    );
  });

  // Style cleanup, 2026-09-04 — the interestConceptType @Audit() calls
  // (added 2026-09-03, see DATABASE.md) were never backfilled into this
  // map, so the client saw raw "interestConceptType.create" etc. in
  // Auditoría. Same class of bug as the block above, own test so a future
  // regression here is caught independently of the Phase 32 set.
  it('translates every interestConceptType action', () => {
    expect(formatAuditAction('interestConceptType.create')).toBe(
      'Creó un tipo de cargo',
    );
    expect(formatAuditAction('interestConceptType.update')).toBe(
      'Editó un tipo de cargo',
    );
    expect(formatAuditAction('interestConceptType.deactivate')).toBe(
      'Desactivó un tipo de cargo',
    );
    expect(formatAuditAction('interestConceptType.activate')).toBe(
      'Reactivó un tipo de cargo',
    );
    expect(formatAuditAction('interestConceptType.delete')).toBe(
      'Eliminó un tipo de cargo',
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
      'interestConceptType.create',
      'interestConceptType.update',
      'interestConceptType.deactivate',
      'interestConceptType.activate',
      'interestConceptType.delete',
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

  it('translates clientsImport and loanImport, the entityTypes from the 2026-09-06 import split', () => {
    expect(formatAuditEntityType('clientsImport')).toBe(
      'Importación de clientes',
    );
    expect(formatAuditEntityType('loanImport')).toBe(
      'Importación de préstamos',
    );
  });

  it('translates interestConceptType, the entityType that previously fell through unlabeled', () => {
    expect(formatAuditEntityType('interestConceptType')).toBe('Tipo de cargo');
  });

  it('translates whatsappCron', () => {
    expect(formatAuditEntityType('whatsappCron')).toBe(
      'Recordatorio automático',
    );
  });

  it('translates whatsappTicket', () => {
    expect(formatAuditEntityType('whatsappTicket')).toBe(
      'Conversación de WhatsApp',
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
