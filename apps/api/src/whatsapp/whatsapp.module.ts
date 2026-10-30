import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ClientsModule } from '../clients/clients.module';
import { Client } from '../clients/entities/client.entity';
import { ClientMessageFrequency } from '../clients/entities/clientMessageFrequency.entity';
import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { LoanInstallmentConcept } from '../loans/entities/loanInstallmentConcept.entity';
import { Payment } from '../loans/entities/payment.entity';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';

import { BankAccountController } from './bankAccount.controller';
import { BankAccountService } from './bankAccount.service';
import { ClientBreakdownService } from './clientBreakdown.service';
import { AppSetting } from './entities/appSetting.entity';
import { MessageLog } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageTemplate } from './entities/messageTemplate.entity';
import { WhatsappConversationClosure } from './entities/whatsappConversationClosure.entity';
import { WhatsappConversationState } from './entities/whatsappConversationState.entity';
import { WhatsappConversationTicket } from './entities/whatsappConversationTicket.entity';
import { WhatsappInboundMessage } from './entities/whatsappInboundMessage.entity';
import { WhatsappManualReply } from './entities/whatsappManualReply.entity';
import { MessageFrequencyThrottleService } from './messageFrequencyThrottle.service';
import { MessageLogsController } from './messageLogs/messageLogs.controller';
import { MessageLogsService } from './messageLogs/messageLogs.service';
import { MessageLogSubscriber } from './messageLogs/messageLog.subscriber';
import { MessageTemplatesController } from './messageTemplates/messageTemplates.controller';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { CreditReportReminderService } from './creditReportReminder.service';
import { NewLoanReminderService } from './newLoanReminder.service';
import { OverdueReminderService } from './overdueReminder.service';
import { PaymentConfirmationService } from './paymentConfirmation.service';
import { SelfServiceMenuService } from './selfServiceMenu.service';
import { UpcomingDueReminderService } from './upcomingDueReminder.service';
import { WhatsappInboundGateway } from './webhook/whatsappInbound.gateway';
import { WhatsappMediaService } from './webhook/whatsappMedia.service';
import { WhatsappWebhookController } from './webhook/whatsappWebhook.controller';
import { WhatsappWebhookService } from './webhook/whatsappWebhook.service';
import { WhatsappConversationStateService } from './whatsappConversationState.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappConversationTicketService } from './whatsappConversationTicket.service';
import { WhatsappCronService } from './whatsappCron.service';
import { WhatsAppService } from './whatsapp.service';
import { WhatsappOutboundLogService } from './whatsappOutboundLog.service';

// Phase 27 — MessageAudience is deliberately no longer registered here:
// its only consumer (MessageAudiencesService) was removed along with the
// GET/PUT :type/audience endpoints once the overdue/upcoming_due audience
// filter was retired. The message_audiences/message_audience_clients
// tables themselves are untouched (see the Phase 27 migration) — the
// entity class still exists at
// ../whatsapp/entities/messageAudience.entity.ts and is still picked up
// by TypeORM's glob-based entities config for migrations, it's just not
// wired into this module's DI since nothing injects its repository
// anymore. See docs/phases/PHASE_27_MESSAGE_FREQUENCY.md.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MessageTemplate,
      MessageLog,
      MessageLogItem,
      WhatsappInboundMessage,
      WhatsappManualReply,
      WhatsappConversationState,
      WhatsappConversationTicket,
      WhatsappConversationClosure,
      AppSetting,
      Client,
      ClientMessageFrequency,
      Installment,
      Loan,
      Payment,
      // Bug fix, 2026-09-08 — OverdueReminderService, UpcomingDueReminderService
      // and SelfServiceMenuService now need this to compute an installment's
      // real accrued mora instead of silently falling back to the legacy
      // interestRate formula. See reminderInstallmentQueries.ts's/
      // breakdownQueries.ts's own comments.
      LoanInstallmentConcept,
    ]),
    // AuthModule (for JwtModule) and UsersModule — WhatsappInboundGateway
    // verifies a socket connection's access token by hand, see its doc
    // comment.
    AuthModule,
    UsersModule,
    // WhatsappMediaService signs its Cloudinary uploads through
    // UploadsService rather than duplicating that algorithm — see
    // UploadsModule's own comment on why it's exported.
    UploadsModule,
    // Human report, 2026-09-14 — PaymentConfirmationService,
    // OverdueReminderService and UpcomingDueReminderService read a
    // client's saldo a favor via ClientCreditBalanceService, which this
    // exports. One-directional: ClientsModule doesn't import WhatsappModule.
    ClientsModule,
  ],
  controllers: [
    WhatsappController,
    MessageTemplatesController,
    MessageLogsController,
    WhatsappWebhookController,
    BankAccountController,
  ],
  providers: [
    WhatsAppService,
    MessageTemplatesService,
    MessageFrequencyThrottleService,
    MessageLogsService,
    OverdueReminderService,
    NewLoanReminderService,
    UpcomingDueReminderService,
    CreditReportReminderService,
    PaymentConfirmationService,
    WhatsappCronService,
    WhatsappWebhookService,
    WhatsappMediaService,
    WhatsappInboundGateway,
    MessageLogSubscriber,
    WhatsappConversationStateService,
    WhatsappConversationTicketService,
    SelfServiceMenuService,
    WhatsappOutboundLogService,
    BankAccountService,
    ClientBreakdownService,
  ],
  // LoansService calls NewLoanReminderService synchronously after creating
  // a loan — see docs/phases/PHASE_9_MESSAGE_TYPES.md. WhatsappModule does
  // not depend on LoansModule, so this one-directional export isn't
  // circular.
  exports: [NewLoanReminderService, PaymentConfirmationService],
})
export class WhatsappModule {}
