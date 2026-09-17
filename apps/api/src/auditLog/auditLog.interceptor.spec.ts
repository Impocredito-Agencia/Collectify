import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { In, Repository } from 'typeorm';

import { Client } from '../clients/entities/client.entity';
import { InterestConceptType } from '../interestConceptTypes/entities/interestConceptType.entity';
import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { User } from '../users/entities/user.entity';

import { AuditLogInterceptor } from './auditLog.interceptor';
import { AuditLogService } from './auditLog.service';

// The interceptor now does its audit write inside an async IIFE (to
// `await resolveEntityLabel` before calling record — see that method's
// occasional DB lookup), rather than calling record() synchronously
// inside tap() the way it used to. That means `record` is no longer
// guaranteed to have been called by the time `firstValueFrom` resolves —
// tests that assert on `record` need to flush the microtask/macrotask
// queue first. Fire-and-forget code is still fire-and-forget in
// production (nothing here changes that); this is purely a test concern.
const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let auditLogService: { record: jest.Mock };
  let reflector: { get: jest.Mock };
  let clientsRepository: { findOne: jest.Mock };
  let loansRepository: { findOne: jest.Mock };
  let usersRepository: { findOneBy: jest.Mock };
  let interestConceptTypesRepository: { findOneBy: jest.Mock };
  let installmentsRepository: { findOne: jest.Mock; find: jest.Mock };

  const buildContext = (overrides: {
    user?: { id: string };
    params?: Record<string, string>;
    body?: unknown;
  }): ExecutionContext => {
    const request = {
      user: overrides.user,
      params: overrides.params ?? {},
      body: overrides.body ?? {},
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
    } as unknown as ExecutionContext;
  };

  // Explicitly Observable<unknown>, not ReturnType<typeof of> — of() is
  // overloaded, and TS resolves ReturnType against its last (zero-arg)
  // overload, Observable<never>, which then rejects every real call site
  // below (each passes an Observable of some concrete object shape).
  const buildCallHandler = (observable: Observable<unknown>): CallHandler => ({
    handle: () => observable,
  });

  beforeEach(() => {
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    reflector = { get: jest.fn() };
    // Defaults to "not found" — only the client.addReference/
    // updateReference/removeReference fallback path ever calls this, and
    // most tests below don't exercise that path at all.
    clientsRepository = { findOne: jest.fn().mockResolvedValue(null) };
    // Defaults to "not found" — only loan.delete's fallback path (the
    // handler returns void, so there's no promissoryNoteNumber on the
    // response) ever calls this; most tests below don't exercise it.
    loansRepository = { findOne: jest.fn().mockResolvedValue(null) };
    // Defaults to "not found" — only user.delete's pre-fetch (entityType
    // 'user' + a params.id) ever calls this; most tests below don't
    // exercise it. Unlike clientsRepository/loansRepository above, this is
    // looked up BEFORE next.handle() runs, not as a post-response
    // fallback — see the interceptor's constructor comment.
    usersRepository = { findOneBy: jest.fn().mockResolvedValue(null) };
    // Same reasoning as usersRepository above — only
    // interestConceptType.delete's pre-fetch (entityType
    // 'interestConceptType' + a params.id) ever calls this.
    interestConceptTypesRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    // Defaults to "not found" — only payment.register's entityLabel
    // enrichment (added 2026-09-04, human report — the entry didn't say
    // which loan/installment a payment was for) ever calls this. Unlike
    // usersRepository/interestConceptTypesRepository above, this is a
    // post-response fallback like clientsRepository/loansRepository, not a
    // pre-fetch — payments are never hard-deleted.
    installmentsRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      // Bug fix, 2026-09-08 — payment.registerBulk's entityLabel batches
      // one .find() call for every installment in the request, unlike
      // payment.register's single .findOne() above.
      find: jest.fn().mockResolvedValue([]),
    };
    interceptor = new AuditLogInterceptor(
      reflector as unknown as Reflector,
      auditLogService as unknown as AuditLogService,
      clientsRepository as unknown as Repository<Client>,
      loansRepository as unknown as Repository<Loan>,
      usersRepository as unknown as Repository<User>,
      interestConceptTypesRepository as unknown as Repository<InterestConceptType>,
      installmentsRepository as unknown as Repository<Installment>,
    );
  });

  it('passes through untouched when the endpoint has no @Audit() metadata', async () => {
    reflector.get.mockReturnValue(undefined);
    const context = buildContext({});
    const handler = buildCallHandler(of({ id: 'x' }));

    const result = await firstValueFrom(
      await interceptor.intercept(context, handler),
    );

    expect(result).toEqual({ id: 'x' });
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('records the actor, action, entityType, entityId and entityLabel on success', async () => {
    reflector.get.mockReturnValue({
      action: 'client.create',
      entityType: 'client',
    });
    const context = buildContext({
      user: { id: 'user-1' },
      params: {},
      body: { firstName: 'Juana' },
    });
    const handler = buildCallHandler(
      of({ id: 'client-1', firstName: 'Juana', lastName: 'Pérez' }),
    );

    await firstValueFrom(await interceptor.intercept(context, handler));
    await flushPromises();

    expect(auditLogService.record).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      action: 'client.create',
      entityType: 'client',
      entityId: 'client-1',
      entityLabel: 'Juana Pérez',
      metadata: { params: {}, body: { firstName: 'Juana' } },
    });
  });

  it('falls back to the route param id when the response has none (e.g. a 204 delete)', async () => {
    reflector.get.mockReturnValue({
      action: 'client.deactivate',
      entityType: 'client',
    });
    const context = buildContext({
      user: { id: 'user-1' },
      params: { id: 'client-1' },
    });
    const handler = buildCallHandler(of(undefined));

    await firstValueFrom(await interceptor.intercept(context, handler));
    await flushPromises();

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'client-1' }),
    );
  });

  // Regression case: POST /installments/:id/payments — the route's :id is
  // the INSTALLMENT being paid, not the payment being created. Using the
  // response's id instead avoids logging payment.register entries against
  // the wrong entity.
  it('prefers the response id over a mismatched route param', async () => {
    reflector.get.mockReturnValue({
      action: 'payment.register',
      entityType: 'payment',
    });
    const context = buildContext({
      user: { id: 'user-1' },
      params: { id: 'installment-1' },
    });
    const handler = buildCallHandler(of({ id: 'payment-1', amountPaid: 100 }));

    await firstValueFrom(await interceptor.intercept(context, handler));
    await flushPromises();

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'payment-1' }),
    );
  });

  it('records null actorUserId when there is no authenticated user', async () => {
    reflector.get.mockReturnValue({
      action: 'client.create',
      entityType: 'client',
    });
    const context = buildContext({ params: {}, body: {} });
    const handler = buildCallHandler(of({ id: 'client-1' }));

    await firstValueFrom(await interceptor.intercept(context, handler));
    await flushPromises();

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null }),
    );
  });

  it('redacts password-like fields from the logged request body', async () => {
    reflector.get.mockReturnValue({
      action: 'user.create',
      entityType: 'user',
    });
    const context = buildContext({
      user: { id: 'admin-1' },
      params: {},
      body: { email: 'a@b.com', password: 'super-secret' },
    });
    const handler = buildCallHandler(of({ id: 'user-1', email: 'a@b.com' }));

    await firstValueFrom(await interceptor.intercept(context, handler));
    await flushPromises();

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          params: {},
          body: { email: 'a@b.com', password: '[redacted]' },
        },
      }),
    );
  });

  it('does not log anything when the request itself fails', async () => {
    reflector.get.mockReturnValue({
      action: 'loan.create',
      entityType: 'loan',
    });
    const context = buildContext({
      user: { id: 'user-1' },
      params: {},
      body: {},
    });
    const handler = buildCallHandler(throwError(() => new Error('rejected')));

    await expect(
      firstValueFrom(await interceptor.intercept(context, handler)),
    ).rejects.toThrow('rejected');
    await flushPromises();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('does not fail the request when the audit write itself fails', async () => {
    auditLogService.record.mockRejectedValue(new Error('db down'));
    reflector.get.mockReturnValue({
      action: 'client.create',
      entityType: 'client',
    });
    const context = buildContext({
      user: { id: 'user-1' },
      params: {},
      body: {},
    });
    const handler = buildCallHandler(of({ id: 'client-1' }));

    const result = await firstValueFrom(
      await interceptor.intercept(context, handler),
    );
    await flushPromises();

    expect(result).toEqual({ id: 'client-1' });
  });

  // resolveEntityLabel — client feedback on Auditoría: "Cliente" alone,
  // or "Préstamo" alone, doesn't say WHICH one. See AuditLog.entityLabel.
  describe('entityLabel resolution', () => {
    it('builds a "name (CC document)" label for direct client actions', async () => {
      reflector.get.mockReturnValue({
        action: 'client.update',
        entityType: 'client',
      });
      const context = buildContext({ user: { id: 'user-1' }, params: {} });
      const handler = buildCallHandler(
        of({
          id: 'client-1',
          firstName: 'Carlos',
          lastName: 'Gómez',
          documentNumber: '1234567890',
        }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: 'Carlos Gómez (CC 1234567890)',
        }),
      );
    });

    // client.addReference/updateReference/removeReference return the
    // ClientReference row, not the Client — no client name on the
    // response, so this falls back to looking the client up by the
    // route's :id (always the client, even on these sub-routes).
    it('falls back to a client lookup by route id for reference sub-actions', async () => {
      reflector.get.mockReturnValue({
        action: 'client.addReference',
        entityType: 'client',
      });
      clientsRepository.findOne.mockResolvedValue({
        id: 'client-1',
        firstName: 'Ana',
        lastName: 'Ruiz',
        documentNumber: '999',
      });
      const context = buildContext({
        user: { id: 'user-1' },
        params: { id: 'client-1' },
      });
      const handler = buildCallHandler(
        of({ id: 'reference-1', fullName: 'Hermano de Ana' }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(clientsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        withDeleted: true,
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: 'Ana Ruiz (CC 999)' }),
      );
    });

    it('resolves a null entityLabel when the reference-lookup client is gone', async () => {
      reflector.get.mockReturnValue({
        action: 'client.removeReference',
        entityType: 'client',
      });
      clientsRepository.findOne.mockResolvedValue(null);
      const context = buildContext({
        user: { id: 'user-1' },
        params: { id: 'client-1', referenceId: 'reference-1' },
      });
      const handler = buildCallHandler(of(undefined));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: null }),
      );
    });

    it('labels a loan by its pagaré number', async () => {
      reflector.get.mockReturnValue({
        action: 'loan.refinance',
        entityType: 'loan',
      });
      const context = buildContext({ user: { id: 'user-1' }, params: {} });
      const handler = buildCallHandler(
        of({ id: 'loan-1', promissoryNoteNumber: '743' }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: 'Pagaré #743' }),
      );
    });

    // loan.delete (Phase 30) returns void (204 No Content) — no
    // promissoryNoteNumber on the response, so this falls back to a
    // withDeleted lookup by the route's :id, mirroring the client
    // reference-sub-action fallback above.
    it('falls back to a loan lookup by route id when the response has no entity', async () => {
      reflector.get.mockReturnValue({
        action: 'loan.delete',
        entityType: 'loan',
      });
      loansRepository.findOne.mockResolvedValue({
        id: 'loan-1',
        promissoryNoteNumber: '743',
      });
      const context = buildContext({
        user: { id: 'user-1' },
        params: { id: 'loan-1' },
      });
      const handler = buildCallHandler(of(undefined));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(loansRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'loan-1' },
        withDeleted: true,
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: 'Pagaré #743' }),
      );
    });

    it('resolves a null entityLabel when the loan-lookup fallback finds nothing', async () => {
      reflector.get.mockReturnValue({
        action: 'loan.delete',
        entityType: 'loan',
      });
      loansRepository.findOne.mockResolvedValue(null);
      const context = buildContext({
        user: { id: 'user-1' },
        params: { id: 'loan-1' },
      });
      const handler = buildCallHandler(of(undefined));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: null }),
      );
    });

    it('labels a payment by its amount and paid date', async () => {
      reflector.get.mockReturnValue({
        action: 'payment.register',
        entityType: 'payment',
      });
      const context = buildContext({
        user: { id: 'user-1' },
        params: { id: 'installment-1' },
      });
      const handler = buildCallHandler(
        of({ id: 'payment-1', amountPaid: 150000, paidAt: '2026-08-18' }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      // Avoids indexing into `auditLogService.record.mock.calls` directly
      // (that's `any` — jest's Mock type doesn't know record()'s param
      // shape here — and eslint's no-unsafe-* rules correctly reject
      // reading properties off it). expect.objectContaining +
      // stringContaining/stringMatching checks the same thing type-safely.
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining('2026-08-18') as unknown,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringMatching(/Pago de/) as unknown,
        }),
      );
    });

    // Human report, 2026-09-04: "Registró un pago" entries only showed the
    // amount and date, with no way to tell which loan/installment it was
    // for. When the response carries an installmentId, this looks the
    // installment (and its loan) up to append that context.
    it('appends the installment number and pagaré to a payment label when the installment is found', async () => {
      reflector.get.mockReturnValue({
        action: 'payment.register',
        entityType: 'payment',
      });
      installmentsRepository.findOne.mockResolvedValue({
        id: 'installment-1',
        installmentNumber: 3,
        loan: { id: 'loan-1', promissoryNoteNumber: '#0910' },
      });
      const context = buildContext({
        user: { id: 'user-1' },
        params: { id: 'installment-1' },
      });
      const handler = buildCallHandler(
        of({
          id: 'payment-1',
          installmentId: 'installment-1',
          amountPaid: 110667,
          paidAt: '2026-09-03',
        }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(installmentsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'installment-1' },
        withDeleted: true,
        relations: { loan: true },
      });
      // Not an exact-string match on the whole label — same reasoning as
      // the "amount and paid date" test above: Intl.NumberFormat('es-CO',
      // ...) inserts a NON-BREAKING space (U+00A0) between "$" and the
      // digits, which is visually indistinguishable from a regular space
      // in a terminal/diff but fails strict equality. Assert on the pieces
      // this test actually cares about instead, same
      // stringContaining/stringMatching pattern as that test (see its own
      // comment for why not `.mock.calls[0][0]` directly).
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringMatching(/^Pago de/) as unknown,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining('el 2026-09-03') as unknown,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining(
            '— cuota 3 del pagaré #0910',
          ) as unknown,
        }),
      );
    });

    it('falls back to the plain amount/date payment label when the installment lookup finds nothing', async () => {
      reflector.get.mockReturnValue({
        action: 'payment.register',
        entityType: 'payment',
      });
      installmentsRepository.findOne.mockResolvedValue(null);
      const context = buildContext({
        user: { id: 'user-1' },
        params: { id: 'installment-1' },
      });
      const handler = buildCallHandler(
        of({
          id: 'payment-1',
          installmentId: 'installment-1',
          amountPaid: 110667,
          paidAt: '2026-09-03',
        }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      // Same non-breaking-space caveat as above — assert the fallback
      // stayed plain (no "cuota"/"pagaré" appended) rather than the exact
      // currency-formatted string.
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringMatching(/^Pago de/) as unknown,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining('el 2026-09-03') as unknown,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.not.stringContaining('cuota') as unknown,
        }),
      );
    });

    // Human report, 2026-09-09 — a voided payment's audit entry must call
    // out that it was ANULADO, with its reason, and still identify which
    // cuota/pagaré it belonged to (voidPayment's response carries
    // deletedAt/voidReason and the same installment relation
    // payment.register's own lookup already knows how to read).
    it('labels a voided payment with ANULADO, its reason, and the cuota/pagaré it belonged to', async () => {
      reflector.get.mockReturnValue({
        action: 'payment.void',
        entityType: 'payment',
      });
      installmentsRepository.findOne.mockResolvedValue({
        id: 'installment-1',
        installmentNumber: 3,
        loan: { id: 'loan-1', promissoryNoteNumber: '#0910' },
      });
      const context = buildContext({
        user: { id: 'user-1' },
        params: { id: 'payment-1' },
      });
      const handler = buildCallHandler(
        of({
          id: 'payment-1',
          installmentId: 'installment-1',
          amountPaid: 110667,
          paidAt: '2026-09-03',
          deletedAt: new Date('2026-09-09'),
          voidReason: 'Se registró el monto completo por error.',
        }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringMatching(/^Pago de/) as unknown,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining(
            'ANULADO — motivo: Se registró el monto completo por error.',
          ) as unknown,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining(
            '— cuota 3 del pagaré #0910',
          ) as unknown,
        }),
      );
    });

    it('labels a voided payment with a generic "sin especificar" reason when none was recorded', async () => {
      reflector.get.mockReturnValue({
        action: 'payment.void',
        entityType: 'payment',
      });
      installmentsRepository.findOne.mockResolvedValue(null);
      const context = buildContext({
        user: { id: 'user-1' },
        params: { id: 'payment-1' },
      });
      const handler = buildCallHandler(
        of({
          id: 'payment-1',
          installmentId: 'installment-1',
          amountPaid: 110667,
          paidAt: '2026-09-03',
          deletedAt: new Date('2026-09-09'),
          voidReason: null,
        }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining(
            'ANULADO — motivo: sin especificar',
          ) as unknown,
        }),
      );
    });

    // Bug fix, 2026-09-08 (human report): "Registró un pago sobre varias
    // cuotas" had no entityLabel at all — payment.registerBulk's response
    // is a Payment[] array, which the single-payment branch above never
    // matched (entity.amountPaid is undefined on an array).
    it('labels a bulk payment with the total amount and every cuota/pagaré it touched', async () => {
      reflector.get.mockReturnValue({
        action: 'payment.registerBulk',
        entityType: 'payment',
      });
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'installment-1',
          installmentNumber: 4,
          loan: { id: 'loan-1', promissoryNoteNumber: '#0743' },
        },
        {
          id: 'installment-2',
          installmentNumber: 1,
          loan: { id: 'loan-2', promissoryNoteNumber: '#0810' },
        },
      ]);
      const context = buildContext({ user: { id: 'user-1' }, params: {} });
      const handler = buildCallHandler(
        of([
          {
            id: 'payment-1',
            installmentId: 'installment-1',
            amountPaid: 300000,
            paidAt: '2026-09-08',
          },
          {
            id: 'payment-2',
            installmentId: 'installment-2',
            amountPaid: 170000,
            paidAt: '2026-09-08',
          },
        ]),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(installmentsRepository.find).toHaveBeenCalledWith({
        where: { id: In(['installment-1', 'installment-2']) },
        withDeleted: true,
        relations: { loan: true },
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringMatching(/^Pago de/) as unknown,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining('en 2 cuotas') as unknown,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining(
            'cuota 4 del pagaré #0743',
          ) as unknown,
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining(
            'cuota 1 del pagaré #0810',
          ) as unknown,
        }),
      );
    });

    // Human report, 2026-09-09 — one "cuota N del pagaré #X" segment per
    // installment made a same-loan batch of 3+ cuotas unreadably long
    // ("cuota 4 del pagaré #2, cuota 5 del pagaré #2, cuota 6 del pagaré
    // #2"), forcing every other column in the audit table to shrink.
    it('groups a bulk payment’s cuotas by pagaré into one compact segment each', async () => {
      reflector.get.mockReturnValue({
        action: 'payment.registerBulk',
        entityType: 'payment',
      });
      installmentsRepository.find.mockResolvedValue([
        {
          id: 'installment-4',
          installmentNumber: 4,
          loan: { id: 'loan-1', promissoryNoteNumber: '#2' },
        },
        {
          id: 'installment-5',
          installmentNumber: 5,
          loan: { id: 'loan-1', promissoryNoteNumber: '#2' },
        },
        {
          id: 'installment-6',
          installmentNumber: 6,
          loan: { id: 'loan-1', promissoryNoteNumber: '#2' },
        },
      ]);
      const context = buildContext({ user: { id: 'user-1' }, params: {} });
      const handler = buildCallHandler(
        of([
          {
            id: 'payment-1',
            installmentId: 'installment-4',
            amountPaid: 100000,
            paidAt: '2026-09-09',
          },
          {
            id: 'payment-2',
            installmentId: 'installment-5',
            amountPaid: 100000,
            paidAt: '2026-09-09',
          },
          {
            id: 'payment-3',
            installmentId: 'installment-6',
            amountPaid: 101334,
            paidAt: '2026-09-09',
          },
        ]),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringContaining(
            'cuotas 4, 5 y 6 del pagaré #2',
          ) as unknown,
        }),
      );
    });

    it('falls back to just the total when a bulk payment’s installments can’t be found', async () => {
      reflector.get.mockReturnValue({
        action: 'payment.registerBulk',
        entityType: 'payment',
      });
      installmentsRepository.find.mockResolvedValue([]);
      const context = buildContext({ user: { id: 'user-1' }, params: {} });
      const handler = buildCallHandler(
        of([
          {
            id: 'payment-1',
            installmentId: 'installment-1',
            amountPaid: 300000,
            paidAt: '2026-09-08',
          },
        ]),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: expect.stringMatching(
            /^Pago de .+ en 1 cuotas$/,
          ) as unknown,
        }),
      );
    });

    it('labels a user by full name and email', async () => {
      reflector.get.mockReturnValue({
        action: 'user.deactivate',
        entityType: 'user',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { id: 'user-1' },
      });
      const handler = buildCallHandler(
        of({ id: 'user-1', fullName: 'Laura Díaz', email: 'laura@x.com' }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: 'Laura Díaz (laura@x.com)',
        }),
      );
    });

    // user.delete (Phase 20 follow-up) returns void (204 No Content), and
    // unlike client/loan the row is genuinely gone by response time (a
    // real SQL DELETE, not a soft-delete) — so this relies on the
    // pre-fetch intercept() does BEFORE next.handle() runs, not a
    // post-response withDeleted lookup like the loan.delete case above.
    it('labels a deleted user from the pre-fetched snapshot when the response has none', async () => {
      reflector.get.mockReturnValue({
        action: 'user.delete',
        entityType: 'user',
      });
      usersRepository.findOneBy.mockResolvedValue({
        id: 'user-1',
        fullName: 'Laura Díaz',
        email: 'laura@x.com',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { id: 'user-1' },
      });
      const handler = buildCallHandler(of(undefined));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(usersRepository.findOneBy).toHaveBeenCalledWith({
        id: 'user-1',
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: 'Laura Díaz (laura@x.com)',
        }),
      );
    });

    it('resolves a null entityLabel when the pre-fetched user is gone', async () => {
      reflector.get.mockReturnValue({
        action: 'user.delete',
        entityType: 'user',
      });
      usersRepository.findOneBy.mockResolvedValue(null);
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { id: 'user-1' },
      });
      const handler = buildCallHandler(of(undefined));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: null }),
      );
    });

    it('labels a usury rate by percentage and month', async () => {
      reflector.get.mockReturnValue({
        action: 'usuryRate.create',
        entityType: 'usuryRate',
      });
      const context = buildContext({ user: { id: 'admin-1' }, params: {} });
      const handler = buildCallHandler(
        of({
          id: 'rate-1',
          ratePercentage: 28.5,
          effectiveMonth: '2026-08-01',
        }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: '28.5% desde 2026-08-01',
        }),
      );
    });

    // interestConceptType (2026-09-03, human report — this entityType had
    // no @Audit at all before this point). create/update/deactivate all
    // return the full entity, so this reads straight off the response.
    it('labels an interest concept type by its name', async () => {
      reflector.get.mockReturnValue({
        action: 'interestConceptType.create',
        entityType: 'interestConceptType',
      });
      const context = buildContext({ user: { id: 'admin-1' }, params: {} });
      const handler = buildCallHandler(
        of({ id: 'concept-1', name: 'Gastos de cobranza' }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: 'Gastos de cobranza' }),
      );
    });

    // interestConceptType.delete returns void (204 No Content), and unlike
    // client/loan the row is genuinely gone by response time (a real SQL
    // DELETE) — same shape as user.delete above, relies on the pre-fetch
    // intercept() does BEFORE next.handle() runs.
    it('labels a deleted interest concept type from the pre-fetched snapshot when the response has none', async () => {
      reflector.get.mockReturnValue({
        action: 'interestConceptType.delete',
        entityType: 'interestConceptType',
      });
      interestConceptTypesRepository.findOneBy.mockResolvedValue({
        id: 'concept-1',
        name: 'Gastos de cobranza',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { id: 'concept-1' },
      });
      const handler = buildCallHandler(of(undefined));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(interestConceptTypesRepository.findOneBy).toHaveBeenCalledWith({
        id: 'concept-1',
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: 'Gastos de cobranza' }),
      );
    });

    it('resolves a null entityLabel when the pre-fetched interest concept type is gone', async () => {
      reflector.get.mockReturnValue({
        action: 'interestConceptType.delete',
        entityType: 'interestConceptType',
      });
      interestConceptTypesRepository.findOneBy.mockResolvedValue(null);
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { id: 'concept-1' },
      });
      const handler = buildCallHandler(of(undefined));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: null }),
      );
    });

    // Human report, 2026-09-10 — docs/DATABASE.md's 2026-09-03 coverage
    // sweep had flagged "cron pause/resume/reschedule" as missing
    // @Audit() entirely; this covers the label rule added to close that
    // specific gap.
    it('labels a paused reminder family by its Spanish name', async () => {
      reflector.get.mockReturnValue({
        action: 'whatsappCron.pause',
        entityType: 'whatsappCron',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { family: 'overdue' },
      });
      const handler = buildCallHandler(of({ paused: true }));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: 'Cuotas vencidas — pausado',
        }),
      );
    });

    it('labels a resumed reminder family by its Spanish name', async () => {
      reflector.get.mockReturnValue({
        action: 'whatsappCron.resume',
        entityType: 'whatsappCron',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { family: 'upcoming_due' },
      });
      const handler = buildCallHandler(of({ paused: false }));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: 'Cuotas próximas a vencer — reanudado',
        }),
      );
    });

    // Human report, 2026-09-14 — the raw cron expression used to be
    // shown verbatim, unreadable in the audit log. See
    // formatCronScheduleLabel's own tests for every day/time-shape case;
    // this just confirms the interceptor actually calls through it.
    it('labels a rescheduled reminder family with a human-readable schedule', async () => {
      reflector.get.mockReturnValue({
        action: 'whatsappCron.reschedule',
        entityType: 'whatsappCron',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { family: 'new_loan' },
      });
      const handler = buildCallHandler(
        of({ id: 'template-1', cronExpression: '0 8 * * 1' }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel:
            'Nuevo pagaré / Refinanciación — nuevo horario: Lun a las 8:00 a. m.',
        }),
      );
    });

    it('falls back to the raw family string when it is not a known ReminderFamily', async () => {
      reflector.get.mockReturnValue({
        action: 'whatsappCron.pause',
        entityType: 'whatsappCron',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { family: 'not_a_real_family' },
      });
      const handler = buildCallHandler(of({ paused: true }));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: 'not_a_real_family — pausado',
        }),
      );
    });

    // Human report, 2026-09-13 — closes another item off the same
    // 2026-09-03 coverage sweep as whatsappCron above: close-conversation
    // had no @Audit() at all. Its response (`{ sent: boolean }`) carries
    // no client, so this looks the client up by the phoneNumber submitted
    // in the request body instead of reading it off the response.
    it('labels a resolved ticket by the client found from the submitted phone number', async () => {
      reflector.get.mockReturnValue({
        action: 'whatsappTicket.resolve',
        entityType: 'whatsappTicket',
      });
      clientsRepository.findOne.mockResolvedValue({
        firstName: 'Ana',
        lastName: 'Gómez',
        documentNumber: '123456',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        body: { phoneNumber: '+573001234567' },
      });
      const handler = buildCallHandler(of({ sent: true }));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(clientsRepository.findOne).toHaveBeenCalledWith({
        where: [
          { phoneNumber: '+573001234567' },
          { alternatePhoneNumber: '+573001234567' },
        ],
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: 'Ana Gómez (CC 123456)',
        }),
      );
    });

    it('falls back to the raw phone number when no client matches it', async () => {
      reflector.get.mockReturnValue({
        action: 'whatsappTicket.resolve',
        entityType: 'whatsappTicket',
      });
      clientsRepository.findOne.mockResolvedValue(null);
      const context = buildContext({
        user: { id: 'admin-1' },
        body: { phoneNumber: '+573001234567' },
      });
      const handler = buildCallHandler(of({ sent: false }));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: '+573001234567' }),
      );
    });

    // Human report, 2026-09-15 — closes the "whatsapp.sendReminder"/
    // "whatsapp.sendUpcomingDue" items off the same 2026-09-03 coverage
    // sweep as whatsappCron/whatsappTicket above. These route as
    // POST /whatsapp/clients/:clientId/..., not :id like every other
    // client-entityType action, and their response is a MessageLog[] with
    // no client fields to read — this always falls to the clientId lookup.
    it('labels a manually-triggered reminder by looking the client up via params.clientId', async () => {
      reflector.get.mockReturnValue({
        action: 'whatsapp.sendReminder',
        entityType: 'client',
      });
      clientsRepository.findOne.mockResolvedValue({
        firstName: 'Mario',
        lastName: 'Ruiz',
        documentNumber: '999888',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { clientId: 'client-1' },
      });
      const handler = buildCallHandler(
        of([{ id: 'log-1', clientId: 'client-1' }]),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(clientsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        withDeleted: true,
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'client-1',
          entityLabel: 'Mario Ruiz (CC 999888)',
        }),
      );
    });

    // Human report, 2026-09-15 — closes the "reply" item off the same
    // coverage sweep. Same dual-match phone lookup as whatsappTicket
    // above; the response (`{ sent: boolean }`) carries no client either.
    it('labels a manual reply by the client found from the submitted phone number, with a preview of the message', async () => {
      reflector.get.mockReturnValue({
        action: 'whatsapp.reply',
        entityType: 'whatsappReply',
      });
      clientsRepository.findOne.mockResolvedValue({
        firstName: 'Ana',
        lastName: 'Gómez',
        documentNumber: '123456',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        body: { phoneNumber: '+573001234567', message: 'Ya casi le pago' },
      });
      const handler = buildCallHandler(of({ sent: true }));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: 'Ana Gómez (CC 123456) — "Ya casi le pago"',
        }),
      );
    });

    it('truncates a long manual reply message in the label', async () => {
      reflector.get.mockReturnValue({
        action: 'whatsapp.reply',
        entityType: 'whatsappReply',
      });
      clientsRepository.findOne.mockResolvedValue(null);
      const longMessage = 'x'.repeat(100);
      const context = buildContext({
        user: { id: 'admin-1' },
        body: { phoneNumber: '+573001234567', message: longMessage },
      });
      const handler = buildCallHandler(of({ sent: true }));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      const [[{ entityLabel }]] = auditLogService.record.mock.calls as [
        [{ entityLabel: string }],
      ];
      expect(entityLabel).toBe(`+573001234567 — "${'x'.repeat(60)}…"`);
    });

    it('marks a manual reply "no entregado" when the send failed', async () => {
      reflector.get.mockReturnValue({
        action: 'whatsapp.reply',
        entityType: 'whatsappReply',
      });
      clientsRepository.findOne.mockResolvedValue(null);
      const context = buildContext({
        user: { id: 'admin-1' },
        body: { phoneNumber: '+573001234567', message: 'Hola' },
      });
      const handler = buildCallHandler(of({ sent: false }));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: '+573001234567 — "Hola" (no entregado)',
        }),
      );
    });

    // Human report, 2026-09-15 — closes the "message_logs.retry" item off
    // the same coverage sweep. The response is the NEW MessageLog row the
    // retry created — only clientId, no client fields — so this looks the
    // client up the same way the 'payment' case looks up an installment.
    it('labels a message retry by looking up the client from the new log row', async () => {
      reflector.get.mockReturnValue({
        action: 'messageLog.retry',
        entityType: 'messageLogRetry',
      });
      clientsRepository.findOne.mockResolvedValue({
        firstName: 'Luis',
        lastName: 'Pardo',
        documentNumber: '777666',
      });
      const context = buildContext({
        user: { id: 'admin-1' },
        params: { id: 'log-original' },
      });
      const handler = buildCallHandler(
        of({ id: 'log-2', clientId: 'client-1', status: 'sent' }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(clientsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        withDeleted: true,
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel: 'Reintento de mensaje — Luis Pardo (CC 777666)',
        }),
      );
    });

    it('marks a message retry "no entregado" when the retry itself failed', async () => {
      reflector.get.mockReturnValue({
        action: 'messageLog.retry',
        entityType: 'messageLogRetry',
      });
      clientsRepository.findOne.mockResolvedValue({
        firstName: 'Luis',
        lastName: 'Pardo',
        documentNumber: '777666',
      });
      const context = buildContext({ user: { id: 'admin-1' } });
      const handler = buildCallHandler(
        of({ id: 'log-2', clientId: 'client-1', status: 'failed' }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityLabel:
            'Reintento de mensaje — Luis Pardo (CC 777666) (no entregado)',
        }),
      );
    });

    it('resolves a null entityLabel for a message retry whose client cannot be found', async () => {
      reflector.get.mockReturnValue({
        action: 'messageLog.retry',
        entityType: 'messageLogRetry',
      });
      clientsRepository.findOne.mockResolvedValue(null);
      const context = buildContext({ user: { id: 'admin-1' } });
      const handler = buildCallHandler(
        of({ id: 'log-2', clientId: 'client-1', status: 'sent' }),
      );

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: null }),
      );
    });

    it('resolves a null entityLabel for an entityType with no labeling rule', async () => {
      reflector.get.mockReturnValue({
        action: 'something.new',
        entityType: 'somethingElse',
      });
      const context = buildContext({ user: { id: 'user-1' }, params: {} });
      const handler = buildCallHandler(of({ id: 'x-1' }));

      await firstValueFrom(await interceptor.intercept(context, handler));
      await flushPromises();

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityLabel: null }),
      );
    });
  });
});
