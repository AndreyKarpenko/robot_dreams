import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { checkOrderOwner, OrderAccess } from './order-access';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { verifyStreamToken } from './stream-token';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEvents: OrderEventsService,
    private readonly orders: OrdersRepository,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(createOrderDto);
  }

  @Get()
  findAll() {
    return this.ordersService.findAll();
  }

  @Get(':id/events')
  async events(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = verifyStreamToken(readRequestToken(req) ?? '');
    const access = await checkOrderOwner(this.orders, id, userId);
    if (!access.ok) {
      res.status(accessStatus(access.error)).json(access);
      return;
    }

    const lastEventId = readLastEventId(req.headers['last-event-id']);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1000\n\n');

    let closed = false;
    let stop: () => void = () => undefined;
    const heartbeat = setInterval(() => {
      if (!closed) {
        res.write(': ping\n\n');
      }
    }, 15000);
    heartbeat.unref();

    const close = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(heartbeat);
      stop();
    };
    req.on('close', close);
    res.on('close', close);

    try {
      stop = await this.orderEvents.subscribeOrder(id, lastEventId, (event) => {
        if (!closed) {
          writeSse(res, event);
        }
      });
    } catch (err) {
      close();
      if (!res.writableEnded) {
        res.end();
      }
      console.error(
        err instanceof Error ? err.message : 'order event stream failed',
      );
    }
    if (closed) {
      stop();
    }
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto.status);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOne(id);
  }
}

function accessStatus(
  error: Exclude<OrderAccess, { ok: true }>['error'],
): number {
  if (error === 'forbidden') {
    return HttpStatus.FORBIDDEN;
  }
  if (error === 'not_found') {
    return HttpStatus.NOT_FOUND;
  }
  return HttpStatus.UNAUTHORIZED;
}

function readRequestToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (match) {
      return match[1];
    }
  }
  const query = req.query.token;
  if (typeof query === 'string' && query.trim() !== '') {
    return query.trim();
  }
  return undefined;
}

function readLastEventId(header: string | string[] | undefined): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw == null || raw.trim() === '') {
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function writeSse(res: Response, event: OrderStatusEvent): void {
  res.write(
    `id: ${event.id}\nevent: order.status\ndata: ${JSON.stringify({
      orderId: event.orderId,
      status: event.status,
    })}\n\n`,
  );
}
