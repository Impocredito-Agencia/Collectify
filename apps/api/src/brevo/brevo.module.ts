import { Module } from '@nestjs/common';

import { BrevoController } from './brevo.controller';
import { BrevoService } from './brevo.service';

// Phase 36 — exported so stage 3's channel selection (inside the whatsapp
// module's reminder services) can send through it.
@Module({
  controllers: [BrevoController],
  providers: [BrevoService],
  exports: [BrevoService],
})
export class BrevoModule {}
