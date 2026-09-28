import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientsListPage } from './ClientsListPage';

import type { PaginatedClients } from './clientsApi';

// Human report, 2026-09-27 — sorting/paging/searching a table used to flash
// "Cargando…" and lose "Mostrando X de Y"/the pager for the split second a
// new page was in flight, because react-query dropped `data` to undefined
// for a query key it hadn't cached yet. Fixed with placeholderData:
// keepPreviousData (see useClients.ts). This test drives the REAL page
// against a controllably-delayed clientsApi, so it fails again if that
// fix is ever reverted — not just a unit test of the hook in isolation.

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', fullName: 'Admin', role: 'admin', modules: [] },
  }),
}));

const page = (names: string[], total: number): PaginatedClients => ({
  items: names.map((name, index) => ({
    id: `c-${name}`,
    firstName: name,
    lastName: 'Prueba',
    documentNumber: String(1000 + index),
    phoneNumber: '+573000000000',
    creditLimit: null,
    documentType: null,
    dateOfBirth: null,
    gender: null,
    documentIssuePlace: null,
    documentIssueDate: null,
    email: null,
    alternatePhoneNumber: null,
    homeAddress: null,
    workAddress: null,
    city: null,
    occupation: null,
    employerName: null,
    monthlyIncome: null,
    idDocumentFrontUrl: null,
    idDocumentBackUrl: null,
    selfieImageUrl: null,
    dataProcessingConsent: true,
    consentGivenAt: null,
    consentDocumentUrl: null,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    activeLoanCount: 0,
    maxOverdueDays: 0,
  })),
  meta: { page: 1, limit: 50, total, totalPages: Math.ceil(total / 50) },
});

let getAll: ReturnType<
  typeof vi.fn<(...args: unknown[]) => Promise<PaginatedClients>>
>;

vi.mock('@/features/clients/clientsApi', async () => {
  const actual = await vi.importActual('@/features/clients/clientsApi');
  return {
    ...actual,
    clientsApi: { getAll: (...args: unknown[]) => getAll(...args) },
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ClientsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// "Mostrando X de Y" and the pager render both above AND below the table
// (see ClientsListPage.tsx's own comment on `paginationBar`) — real
// duplication, not a test artifact, so every assertion on that text
// expects exactly 2 matches.
describe('ClientsListPage — no layout shift while sorting', () => {
  beforeEach(() => {
    getAll = vi.fn();
  });

  it('keeps the rows and both pagers on screen while a re-sort is in flight, instead of flashing back to "Cargando…"', async () => {
    getAll.mockResolvedValueOnce(page(['Elena'], 197));
    renderPage();

    const table = await screen.findByRole('table');
    await within(table).findByText('Elena Prueba');
    expect(screen.getAllByText(/Mostrando 1 de 197 clientes/)).toHaveLength(2);

    // The second call (triggered by the sort click) resolves only once we
    // let it — this is the exact window where the old code lost the pager.
    let resolveSecond!: (value: PaginatedClients) => void;
    getAll.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
    );

    fireEvent.click(screen.getByText('Nombre'));

    // Still mid-fetch: the previous row and both pagers must all still be
    // there — this is what would fail without placeholderData.
    expect(within(table).getByText('Elena Prueba')).toBeTruthy();
    expect(screen.getAllByText(/Mostrando 1 de 197 clientes/)).toHaveLength(2);
    expect(within(table).queryByText('Cargando…')).toBeNull();

    resolveSecond(page(['Zoe'], 197));

    await waitFor(() =>
      expect(within(table).getByText('Zoe Prueba')).toBeTruthy(),
    );
    expect(within(table).queryByText('Elena Prueba')).toBeNull();
  });
});
