import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { JwtPayload } from '../../auth/interfaces/jwtPayload.interface';
import { Configuration } from '../../config/configuration';
import { UserRole } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { WhatsappInboundMessage } from '../entities/whatsappInboundMessage.entity';
import { WhatsappManualReply } from '../entities/whatsappManualReply.entity';

// Real-time push for the "Mensajes entrantes" inbox — see
// docs/phasesClient/PHASE_22_WHATSAPP_WEBHOOK.md. Admin-only, mirroring
// GET /whatsapp/inbound-messages's @Roles(UserRole.Admin): a connecting
// client presents its access token in the handshake and gets disconnected
// immediately if it doesn't resolve to an active admin. Socket.IO's
// handshake never passes through JwtAuthGuard/Passport, so this is
// verified by hand instead of reusing that guard.
@Injectable()
@WebSocketGateway({ namespace: 'whatsapp-inbound' })
export class WhatsappInboundGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(WhatsappInboundGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<Configuration, true>,
    private readonly usersService: UsersService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get('jwt', { infer: true }).secret,
      });

      if (payload.type !== 'access') {
        throw new UnauthorizedException('Invalid token type');
      }

      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.isActive || user.role !== UserRole.Admin) {
        throw new UnauthorizedException('Admin access required');
      }
    } catch (error) {
      this.logger.warn(
        `Rejected websocket connection: ${(error as Error).message}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // No per-connection state kept — nothing to clean up.
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth?.token as string | undefined;
    const headerToken = client.handshake.headers.authorization?.replace(
      'Bearer ',
      '',
    );
    const token = authToken ?? headerToken;
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }
    return token;
  }

  // Called by WhatsappWebhookService right after persisting a new inbound
  // message — pushes it to every connected admin so the inbox updates
  // live, with no page refresh needed.
  emitInboundMessage(message: WhatsappInboundMessage): void {
    this.server.emit('inbound-message', message);
  }

  // Human report, 2026-09-19 — same live-push treatment as an inbound
  // client message, so an admin's manual reply shows up for every OTHER
  // connected admin immediately, not just locally in the sender's own tab.
  emitManualReply(reply: WhatsappManualReply): void {
    this.server.emit('manual-reply', reply);
  }
}
