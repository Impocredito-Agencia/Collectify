import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { validateCronExpression } from 'cron';
import { Repository } from 'typeorm';

import { MessageTemplate } from '../entities/messageTemplate.entity';
import { MessageType } from '../messageType.enum';

// content is read-only by design — see MessageTemplate's entity comment
// and docs/DATABASE.md "Changed after Phase 9". Updating a template's
// content is a migration, not a service method. cronExpression IS
// admin-editable (Phase 18) — see updateCronExpression and
// WhatsappCronService.
@Injectable()
export class MessageTemplatesService {
  constructor(
    @InjectRepository(MessageTemplate)
    private readonly messageTemplatesRepository: Repository<MessageTemplate>,
  ) {}

  findAll(): Promise<MessageTemplate[]> {
    return this.messageTemplatesRepository.find({ order: { type: 'ASC' } });
  }

  async findByTypeOrThrow(type: MessageType): Promise<MessageTemplate> {
    const template = await this.messageTemplatesRepository.findOneBy({
      type,
    });
    if (!template) {
      throw new NotFoundException(
        `No message template is configured for type '${type}'`,
      );
    }
    return template;
  }

  async updateCronExpression(
    type: MessageType,
    cronExpression: string,
  ): Promise<MessageTemplate> {
    const { valid } = validateCronExpression(cronExpression);
    if (!valid) {
      throw new BadRequestException(
        `'${cronExpression}' is not a valid cron expression`,
      );
    }

    const template = await this.findByTypeOrThrow(type);
    template.cronExpression = cronExpression;
    return this.messageTemplatesRepository.save(template);
  }

  // Human report, 2026-09-19 — persists WhatsappCronService.pause()/
  // resume() so it survives a deploy/restart, same "schedule-owner row"
  // convention as updateCronExpression above.
  async updateCronPaused(
    type: MessageType,
    cronPaused: boolean,
  ): Promise<MessageTemplate> {
    const template = await this.findByTypeOrThrow(type);
    template.cronPaused = cronPaused;
    return this.messageTemplatesRepository.save(template);
  }
}
