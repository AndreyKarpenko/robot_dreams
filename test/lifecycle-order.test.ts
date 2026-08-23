import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Container } from '../src/container';
import { Dispatcher } from '../src/dispatcher';
import { Body, Controller, Post } from '../src/decorators';
import { CreateUserSchema } from '../src/dto/create-user.dto';
import type { Guard } from '../src/guards/auth.guard';
import type { Interceptor } from '../src/interceptors/logging.interceptor';
import type { Middleware } from '../src/middleware/middleware';
import { ZodValidationPipe } from '../src/pipes/zod-validation.pipe';
import { Router } from '../src/router';
import { listen } from './http-utils';

describe('request lifecycle order', () => {
    let server: Server | undefined;

    afterEach(async () => {
        vi.restoreAllMocks();

        if (!server) {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            server?.close((error) => (error ? reject(error) : resolve()));
        });

        server = undefined;
    });

    it('runs middleware → guard → interceptor:before → pipe → handler → interceptor:after', async () => {
        const order: string[] = [];

        @Controller('order')
        class OrderController {
            @Post()
            submit(@Body(CreateUserSchema) _dto: unknown) {
                order.push('handler');
                return { ok: true };
            }
        }

        const middleware: Middleware = {
            async use(_req, _res, next) {
                order.push('middleware');
                await next();
            },
        };

        const guard: Guard = {
            canActivate() {
                order.push('guard');
                return true;
            },
        };

        const interceptor: Interceptor = {
            async intercept(_req, next) {
                order.push('interceptor:before');
                const result = await next();
                order.push('interceptor:after');
                return result;
            },
        };

        const originalTransform = ZodValidationPipe.prototype.transform;
        vi.spyOn(ZodValidationPipe.prototype, 'transform').mockImplementation(function (
            this: ZodValidationPipe,
            value: unknown,
        ) {
            order.push('pipe');
            return originalTransform.call(this, value);
        });

        const dispatcher = new Dispatcher(
            new Router([OrderController]),
            new Container(),
            [guard],
            [interceptor],
            [middleware],
        );

        server = createServer((req, res) => {
            void dispatcher.handle(req, res);
        });

        const baseUrl = await listen(server);
        const response = await fetch(`${baseUrl}/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'user@example.com' }),
        });

        expect(response.status).toBe(201);
        expect(order).toEqual([
            'middleware',
            'guard',
            'interceptor:before',
            'pipe',
            'handler',
            'interceptor:after',
        ]);
    });
});
