import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import type { Socket } from 'socket.io';

import { UserRole } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';

import { WhatsappInboundGateway } from './whatsappInbound.gateway';

interface MockSocket {
  handshake: { auth: { token?: string }; headers: Record<string, string> };
  disconnect: jest.Mock;
}

describe('WhatsappInboundGateway', () => {
  let gateway: WhatsappInboundGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let usersService: { findById: jest.Mock };
  let configGet: jest.Mock;
  let emitMock: jest.Mock;

  function buildSocket(token: string | undefined): MockSocket {
    return {
      handshake: {
        auth: { token },
        headers: {},
      },
      disconnect: jest.fn(),
    };
  }

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    usersService = { findById: jest.fn() };
    configGet = jest.fn().mockReturnValue({ secret: 'test-secret' });
    emitMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappInboundGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    gateway = module.get<WhatsappInboundGateway>(WhatsappInboundGateway);
    // @ts-expect-error — private field, injected directly for the test
    gateway.server = { emit: emitMock };
  });

  describe('handleConnection', () => {
    it('accepts a connection from an active admin with a valid access token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'access',
      });
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        role: UserRole.Admin,
        isActive: true,
      });
      const socket = buildSocket('valid-token');

      await gateway.handleConnection(socket as unknown as Socket);

      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects when no token is present', async () => {
      const socket = buildSocket(undefined);

      await gateway.handleConnection(socket as unknown as Socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('disconnects when the token fails verification', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      const socket = buildSocket('bad-token');

      await gateway.handleConnection(socket as unknown as Socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a refresh token (wrong type)', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'refresh',
      });
      const socket = buildSocket('refresh-token');

      await gateway.handleConnection(socket as unknown as Socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a non-admin user', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'access',
      });
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        role: UserRole.Collector,
        isActive: true,
      });
      const socket = buildSocket('valid-token');

      await gateway.handleConnection(socket as unknown as Socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a deactivated admin', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'access',
      });
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        role: UserRole.Admin,
        isActive: false,
      });
      const socket = buildSocket('valid-token');

      await gateway.handleConnection(socket as unknown as Socket);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('emitInboundMessage', () => {
    it('emits the message on the "inbound-message" event', () => {
      const message = { id: 'msg-1' };

      gateway.emitInboundMessage(message as never);

      expect(emitMock).toHaveBeenCalledWith('inbound-message', message);
    });
  });

  // Human report, 2026-09-23 — a reminder cron run inserts one message_logs
  // row per recipient; each must not trigger its own list refetch in every
  // open panel.
  describe('emitConversationUpdate', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('collapses a burst of calls into a single "conversation-update" event', () => {
      gateway.emitConversationUpdate();
      gateway.emitConversationUpdate();
      gateway.emitConversationUpdate();

      expect(emitMock).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000);

      expect(emitMock).toHaveBeenCalledTimes(1);
      expect(emitMock).toHaveBeenCalledWith('conversation-update');
    });

    it('emits again for a call after the previous burst went out', () => {
      gateway.emitConversationUpdate();
      jest.advanceTimersByTime(1000);
      gateway.emitConversationUpdate();
      jest.advanceTimersByTime(1000);

      expect(emitMock).toHaveBeenCalledTimes(2);
    });
  });
});
