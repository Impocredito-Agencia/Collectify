import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isEmail, isPhoneNumber } from 'class-validator';
import { Repository } from 'typeorm';

import { BrevoService } from '../../brevo/brevo.service';
import { BrevoChannel, BrevoSendResult } from '../../brevo/brevoTypes';
import { normalizePhoneNumber } from '../../clients/normalizePhoneNumber';
import { MessageChannelTemplate } from '../entities/messageChannelTemplate.entity';
import { MessageType } from '../messageType.enum';
import {
  exampleParametersFor,
  MESSAGE_TYPE_PARAMETERS,
  MessageTypeParameter,
} from '../messageTypeParameters';
import { toGsm7Text } from '../smsText';
import { renderTemplateBody } from '../templateBodyRenderer';

import {
  findInvalidPlaceholders,
  renderEmailHtml,
  renderEmailText,
} from './channelTemplateText';
import { UpdateMessageChannelTemplateDto } from './dto/updateMessageChannelTemplate.dto';

// An SMS template is the text BEFORE its {{n}} values are filled in, so the
// real message is longer. 480 characters is already 4 credits per send.
export const SMS_BODY_MAX_LENGTH = 480;
export const EMAIL_BODY_MAX_LENGTH = 5000;
export const EMAIL_SUBJECT_MAX_LENGTH = 150;

const TEST_SUBJECT_PREFIX = '[Prueba] ';

export interface MessageChannelTemplateView {
  type: MessageType;
  channel: BrevoChannel;
  subject: string | null;
  body: string;
  updatedAt: Date;
  // What each {{n}} is, with an example value, for the editor.
  parameters: MessageTypeParameter[];
}

export interface RenderedChannelMessage {
  // Email only.
  subject: string | null;
  // Email: plain text with *bold* markers (renderEmailHtml turns it into the
  // HTML part). SMS: the exact GSM-7 text that goes out.
  text: string;
}

// Phase 36, stage 2 — the admin-editable email/SMS wording per message type.
// Rendering takes the same bodyParameters the WhatsApp template of that
// type is sent with, so no figure is ever computed twice.
@Injectable()
export class MessageChannelTemplatesService {
  constructor(
    @InjectRepository(MessageChannelTemplate)
    private readonly channelTemplatesRepository: Repository<MessageChannelTemplate>,
    private readonly brevoService: BrevoService,
  ) {}

  async findAll(): Promise<MessageChannelTemplateView[]> {
    const templates = await this.channelTemplatesRepository.find({
      order: { type: 'ASC', channel: 'ASC' },
    });
    return templates.map((template) => this.toView(template));
  }

  async findOneOrThrow(
    type: MessageType,
    channel: BrevoChannel,
  ): Promise<MessageChannelTemplate> {
    const template = await this.channelTemplatesRepository.findOneBy({
      type,
      channel,
    });
    if (!template) {
      throw new NotFoundException(
        `No ${channel} template is configured for type '${type}'`,
      );
    }
    return template;
  }

  async update(
    type: MessageType,
    channel: BrevoChannel,
    dto: UpdateMessageChannelTemplateDto,
  ): Promise<MessageChannelTemplateView> {
    const template = await this.findOneOrThrow(type, channel);
    const body = dto.body.trim();
    const subject = dto.subject?.trim() || null;

    if (channel === BrevoChannel.Sms) {
      if (subject) {
        throw new BadRequestException('Un SMS no lleva asunto.');
      }
      if (body.length > SMS_BODY_MAX_LENGTH) {
        throw new BadRequestException(
          `El SMS no puede superar ${SMS_BODY_MAX_LENGTH} caracteres.`,
        );
      }
    } else {
      if (!subject) {
        throw new BadRequestException('El correo necesita un asunto.');
      }
      if (subject.length > EMAIL_SUBJECT_MAX_LENGTH) {
        throw new BadRequestException(
          `El asunto no puede superar ${EMAIL_SUBJECT_MAX_LENGTH} caracteres.`,
        );
      }
    }

    const parameterCount = MESSAGE_TYPE_PARAMETERS[type].length;
    const invalid = [
      ...findInvalidPlaceholders(subject ?? '', parameterCount),
      ...findInvalidPlaceholders(body, parameterCount),
    ];
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Marcadores no válidos: ${[...new Set(invalid)].join(', ')}. Este mensaje solo admite {{1}} a {{${parameterCount}}}.`,
      );
    }

    template.subject = subject;
    template.body = body;
    return this.toView(await this.channelTemplatesRepository.save(template));
  }

  render(
    template: MessageChannelTemplate,
    bodyParameters: string[],
  ): RenderedChannelMessage {
    const body = renderTemplateBody(template.body, bodyParameters);
    if (template.channel === BrevoChannel.Sms) {
      return { subject: null, text: toGsm7Text(body) };
    }
    return {
      subject: renderTemplateBody(template.subject ?? '', bodyParameters),
      text: body,
    };
  }

  // Sends the saved template filled with the example values — what the
  // editor's preview shows — through Brevo, subject to the same pauses and
  // test list as any other send.
  async sendTest(
    type: MessageType,
    channel: BrevoChannel,
    to: string,
  ): Promise<BrevoSendResult> {
    const template = await this.findOneOrThrow(type, channel);
    const rendered = this.render(template, exampleParametersFor(type));

    if (channel === BrevoChannel.Sms) {
      const phone = normalizePhoneNumber(to);
      if (typeof phone !== 'string' || !isPhoneNumber(phone, 'CO')) {
        throw new BadRequestException('Ingresa un celular colombiano válido.');
      }
      return this.brevoService.sendSms({ to: phone, content: rendered.text });
    }

    const email = to.trim().toLowerCase();
    if (!isEmail(email)) {
      throw new BadRequestException('Ingresa un correo válido.');
    }
    return this.brevoService.sendEmail({
      to: email,
      subject: `${TEST_SUBJECT_PREFIX}${rendered.subject ?? ''}`,
      htmlContent: renderEmailHtml(rendered.text),
      textContent: renderEmailText(rendered.text),
    });
  }

  private toView(template: MessageChannelTemplate): MessageChannelTemplateView {
    return {
      type: template.type,
      channel: template.channel,
      subject: template.subject,
      body: template.body,
      updatedAt: template.updatedAt,
      parameters: MESSAGE_TYPE_PARAMETERS[template.type],
    };
  }
}
