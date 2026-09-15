import { Test, TestingModule } from '@nestjs/testing';

import { DashboardService } from '../dashboard/dashboard.service';

import { OverdueInstallmentsReportService } from './overdueInstallmentsReport.service';

describe('OverdueInstallmentsReportService', () => {
  let service: OverdueInstallmentsReportService;
  let dashboardService: { getOverdueInstallmentDetails: jest.Mock };

  beforeEach(async () => {
    dashboardService = { getOverdueInstallmentDetails: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueInstallmentsReportService,
        { provide: DashboardService, useValue: dashboardService },
      ],
    }).compile();

    service = module.get(OverdueInstallmentsReportService);
  });

  it('builds a workbook from whatever DashboardService reports as overdue', async () => {
    dashboardService.getOverdueInstallmentDetails.mockResolvedValue([
      {
        clientId: 'client-1',
        clientFirstName: 'Juana',
        clientLastName: 'Pérez',
        clientDocumentNumber: '1234567890',
        clientPhoneNumber: '+573001234567',
        promissoryNoteNumber: '#0800',
        alternateContactPhoneNumber: null,
        installmentNumber: 1,
        dueDate: '2026-08-15',
        amount: 300000,
        interest: 0,
        totalDue: 300000,
        overdueDays: 10,
      },
    ]);

    const buffer = await service.generate();

    expect(dashboardService.getOverdueInstallmentDetails).toHaveBeenCalled();
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
