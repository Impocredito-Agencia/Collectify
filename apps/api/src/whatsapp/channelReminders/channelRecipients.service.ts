import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Client } from '../../clients/entities/client.entity';
import { todayDateString } from '../../loans/dueDateSchedule';
import { InstallmentStatus } from '../../loans/entities/installment.entity';
import { Installment } from '../../loans/entities/installment.entity';
import { LoanStatus } from '../../loans/entities/loan.entity';
import { calculateOverdueDays } from '../../loans/installments/installmentCalculations';

export interface ChannelRecipient {
  clientId: string;
  fullName: string;
  documentNumber: string;
  phoneNumber: string;
  email: string | null;
  // Days overdue of the client's oldest overdue cuota (the same figure the
  // reminders call "la más antigua venció hace…"); null when nothing is
  // overdue — the client is listed only because a channel is on.
  maxOverdueDays: number | null;
  overdueInstallments: number;
  emailRemindersEnabled: boolean;
  smsRemindersEnabled: boolean;
}

export interface ChannelSelectionChange {
  emailRemindersEnabled?: boolean;
  smsRemindersEnabled?: boolean;
}

export interface BulkSelectionResult {
  updatedClientIds: string[];
  // Asked to turn email on, but the client has no email on file.
  skippedWithoutEmail: { clientId: string; fullName: string }[];
}

interface OverdueSummaryRow {
  clientId: string;
  oldestDueDate: string;
  overdueInstallments: string;
}

// Phase 36, stage 3 — who gets the email/SMS reminders. Picked by hand by
// the admin (confirmed with the human), typically the clients with the
// most days of mora: this lists every client with an overdue cuota, most
// days first, plus anyone who already has a channel on.
@Injectable()
export class ChannelRecipientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
  ) {}

  async list(): Promise<ChannelRecipient[]> {
    const today = todayDateString();
    // Same definition of "overdue" as findClientIdsWithOverdueInstallments:
    // a pending cuota past its due date on an active loan.
    const rows = await this.installmentsRepository
      .createQueryBuilder('installment')
      .innerJoin('installment.loan', 'loan')
      .select('loan.client_id', 'clientId')
      .addSelect('MIN(installment.due_date)::text', 'oldestDueDate')
      .addSelect('COUNT(*)', 'overdueInstallments')
      .where('installment.status = :status', {
        status: InstallmentStatus.Pending,
      })
      .andWhere('installment.due_date < :today', { today })
      .andWhere('loan.status = :loanStatus', { loanStatus: LoanStatus.Active })
      .groupBy('loan.client_id')
      .getRawMany<OverdueSummaryRow>();
    const overdueByClientId = new Map(rows.map((row) => [row.clientId, row]));

    const clients = await this.clientsRepository.find({
      where: [
        ...(overdueByClientId.size > 0
          ? [{ id: In([...overdueByClientId.keys()]) }]
          : []),
        { emailRemindersEnabled: true },
        { smsRemindersEnabled: true },
      ],
    });

    return clients
      .map((client) => {
        const overdue = overdueByClientId.get(client.id);
        return {
          clientId: client.id,
          fullName: `${client.firstName} ${client.lastName}`,
          documentNumber: client.documentNumber,
          phoneNumber: client.phoneNumber,
          email: client.email,
          maxOverdueDays: overdue
            ? calculateOverdueDays(new Date(overdue.oldestDueDate))
            : null,
          overdueInstallments: overdue
            ? Number(overdue.overdueInstallments)
            : 0,
          emailRemindersEnabled: client.emailRemindersEnabled,
          smsRemindersEnabled: client.smsRemindersEnabled,
        };
      })
      .sort(
        (a, b) =>
          (b.maxOverdueDays ?? -1) - (a.maxOverdueDays ?? -1) ||
          a.fullName.localeCompare(b.fullName, 'es'),
      );
  }

  async updateOne(
    clientId: string,
    change: ChannelSelectionChange,
  ): Promise<ChannelSelectionChange> {
    const client = await this.clientsRepository.findOneBy({ id: clientId });
    if (!client) {
      throw new NotFoundException(`Client with id ${clientId} not found`);
    }
    if (change.emailRemindersEnabled && !client.email?.trim()) {
      throw new BadRequestException(
        'El cliente no tiene correo registrado. Agrégalo en su ficha antes de activar los recordatorios por correo.',
      );
    }
    const update = this.toUpdate(change);
    await this.clientsRepository.update({ id: clientId }, update);
    return {
      emailRemindersEnabled:
        update.emailRemindersEnabled ?? client.emailRemindersEnabled,
      smsRemindersEnabled:
        update.smsRemindersEnabled ?? client.smsRemindersEnabled,
    };
  }

  async updateMany(
    clientIds: string[],
    change: ChannelSelectionChange,
  ): Promise<BulkSelectionResult> {
    const update = this.toUpdate(change);
    if (Object.keys(update).length === 0) {
      throw new BadRequestException(
        'Indica qué canal activar o desactivar (correo o SMS).',
      );
    }
    const clients = await this.clientsRepository.findBy({
      id: In([...new Set(clientIds)]),
    });

    const skippedWithoutEmail = update.emailRemindersEnabled
      ? clients.filter((client) => !client.email?.trim())
      : [];
    const skipped = new Set(skippedWithoutEmail.map((client) => client.id));
    const updatedClientIds = clients
      .map((client) => client.id)
      .filter((id) => !skipped.has(id));

    if (updatedClientIds.length > 0) {
      await this.clientsRepository.update({ id: In(updatedClientIds) }, update);
    }
    return {
      updatedClientIds,
      skippedWithoutEmail: skippedWithoutEmail.map((client) => ({
        clientId: client.id,
        fullName: `${client.firstName} ${client.lastName}`,
      })),
    };
  }

  private toUpdate(change: ChannelSelectionChange): ChannelSelectionChange {
    const update: ChannelSelectionChange = {};
    if (change.emailRemindersEnabled !== undefined) {
      update.emailRemindersEnabled = change.emailRemindersEnabled;
    }
    if (change.smsRemindersEnabled !== undefined) {
      update.smsRemindersEnabled = change.smsRemindersEnabled;
    }
    return update;
  }
}
