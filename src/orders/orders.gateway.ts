import { OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import { checkOrderOwner } from './order-access';
import { OrderEventsService, orderRoom } from './order-events.service';
import { OrdersRepository } from './orders.repository';
import { verifyStreamToken } from './stream-token';

type JoinResult = { ok: true; room: string } | { ok: false; error: string };

@WebSocketGateway({ cors: { origin: true } })
export class OrdersGateway implements OnGatewayInit, OnModuleDestroy {
  private subscription?: Subscription;

  constructor(
    private readonly orderEvents: OrderEventsService,
    private readonly orders: OrdersRepository,
  ) {}

  afterInit(server: Server): void {
    this.subscription = this.orderEvents.events$.subscribe((event) => {
      server.to(orderRoom(event.orderId)).emit('order.status', {
        orderId: event.orderId,
        status: event.status,
      });
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<JoinResult> {
    const userId = verifyStreamToken(readHandshakeToken(client) ?? '');
    if (!userId) {
      return { ok: false, error: 'unauthorized' };
    }

    const orderId = readOrderId(body);
    if (orderId == null) {
      return { ok: false, error: 'bad_order' };
    }

    const access = await checkOrderOwner(this.orders, orderId, userId);
    if (!access.ok) {
      return access;
    }

    const room = orderRoom(orderId);
    await client.join(room);
    return { ok: true, room };
  }
}

function readHandshakeToken(client: Socket): string | undefined {
  const auth: unknown = client.handshake.auth;
  if (auth == null || typeof auth !== 'object') {
    return undefined;
  }
  const token = (auth as { token?: unknown }).token;
  if (typeof token !== 'string' || token.trim() === '') {
    return undefined;
  }
  return token.trim();
}

function readOrderId(body: unknown): number | undefined {
  const raw =
    typeof body === 'number' || typeof body === 'string'
      ? body
      : body != null && typeof body === 'object' && 'orderId' in body
        ? (body as { orderId?: unknown }).orderId
        : undefined;
  const orderId = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    return undefined;
  }
  return orderId;
}
