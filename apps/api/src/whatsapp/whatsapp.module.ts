import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Client } from '../clients/entities/client.entity';
import { ClientMessageFrequency } from '../clients/entities/clientMessageFrequency.entity';
import { Installment } from '../loans/entities/installment.entity';
import { Loan } from '../loans/entities/loan.entity';
import { Payment } from '../loans/entities/payment.entity';
import { UsersModule } from '../users/users.module';

import { MessageLog } from './entities/messageLog.entity';
import { MessageLogItem } from './entities/messageLogItem.entity';
import { MessageTemplate } from './entities/messageTemplate.entity';
import { WhatsappConversationState } from './entities/whatsappConversationState.entity';
import { WhatsappInboundMessage } from './entities/whatsappInboundMessage.entity';
import { MessageFrequencyThrottleService } from './messageFrequencyThrottle.service';
import { MessageLogsController } from './messageLogs/messageLogs.controller';
import { MessageLogsService } from './messageLogs/messageLogs.service';
import { MessageTemplatesController } from './messageTemplates/messageTemplates.controller';
import { MessageTemplatesService } from './messageTemplates/messageTemplates.service';
import { NewLoanReminderService } from './newLoanReminder.service';
import { OverdueReminderService } from './overdueReminder.service';
import { PaymentConfirmationService } from './paymentConfirmation.service';
import { SelfServiceMenuService } from './selfServiceMenu.service';
import { UpcomingDueReminderService } from './upcomingDueReminder.service';
import { WhatsappInboundGateway } from './webhook/whatsappInbound.gateway';
import { WhatsappWebhookController } from './webhook/whatsappWebhook.controller';
import { WhatsappWebhookService } from './webhook/whatsappWebhook.service';
import { WhatsappConversationStateService } from './whatsappConversationState.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappCronService } from './whatsappCron.service';
import { WhatsAppService } from './whatsapp.service';

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
      WhatsappConversationState,
      Client,
      ClientMessageFrequency,
      Installment,
      Loan,
      Payment,
    ]),
    // AuthModule (for JwtModule) and UsersModule — WhatsappInboundGateway
    // verifies a socket connection's access token by hand, see its doc
    // comment.
    AuthModule,
    UsersModule,
  ],
  controllers: [
    WhatsappController,
    MessageTemplatesController,
    MessageLogsController,
    WhatsappWebhookController,
  ],
  providers: [
    WhatsAppService,
    MessageTemplatesService,
    MessageFrequencyThrottleService,
    MessageLogsService,
    OverdueReminderService,
    NewLoanReminderService,
    UpcomingDueReminderService,
    PaymentConfirmationService,
    WhatsappCronService,
    WhatsappWebhookService,
    WhatsappInboundGateway,
    WhatsappConversationStateService,
    SelfServiceMenuService,
  ],
  // LoansService calls NewLoanReminderService synchronously after creating
  // a loan — see docs/phases/PHASE_9_MESSAGE_TYPES.md. WhatsappModule does
  // not depend on LoansModule, so this one-directional export isn't
  // circular.
  exports: [NewLoanReminderService, PaymentConfirmationService],
})
export class WhatsappModule {}
