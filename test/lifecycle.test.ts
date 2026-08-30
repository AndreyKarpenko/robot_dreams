import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { Container } from '../src/container';
import { Controller, Get } from '../src/decorators';
import { UserController } from '../src/controllers/UserController';
import { Dispatcher } from '../src/dispatcher';
import { LoggingInterceptor, type Interceptor } from '../src/interceptors/logging.interceptor';
import { RequestIdMiddleware, type Middleware } from '../src/middleware/middleware';
import { ZodValidationPipe } from '../src/pipes/zod-validation.pipe';
import { Router } from '../src/router';
import { UserRepository, UserService } from '../src/services';
import { AUTH_HEADERS, listen } from './http-utils';

describe('request lifecycle', () => {
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

    it('blocks a request without Authorization before the handler and returns 403', async () => {
        const handler = vi.spyOn(UserController.prototype, 'findOne');
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users/1`);

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({ message: 'Forbidden' });
        expect(handler).not.toHaveBeenCalled();
    });

    it('rejects with 403 before validation runs, not with 400', async () => {
        const pipe = vi.spyOn(ZodValidationPipe.prototype, 'transform');
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'not-an-email' }),
        });

        expect(response.status).toBe(403);
        expect(pipe).not.toHaveBeenCalled();
    });

    it('lets the exception filter catch an error thrown by a middleware', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        @Controller('never-reached')
        class NeverReachedController {
            @Get()
            ok() {
                return { ok: true };
            }
        }

        const middleware: Middleware = {
            async use() {
                throw new Error('boom');
            },
        };

        const dispatcher = new Dispatcher(
            new Router([NeverReachedController]),
            new Container(),
            [],
            [],
            [middleware],
        );

        server = createServer((req, res) => {
            void dispatcher.handle(req, res);
        });

        const baseUrl = await listen(server);
        const response = await fetch(`${baseUrl}/never-reached`);
        const body = await response.text();

        expect(response.status).toBe(500);
        expect(JSON.parse(body)).toEqual({ message: 'Internal Server Error' });
        expect(body).not.toMatch(/boom|at .*\.ts:/);
    });

    it('logs the route and duration in milliseconds', async () => {
        const lines: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
        });

        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users/1`, { headers: AUTH_HEADERS });

        expect(response.status).toBe(200);
        expect(lines.some((line) => /GET \/users\/1 — \d+(\.\d+)? ms/.test(line))).toBe(true);
        expect(lines.join('\n')).toMatch(/[0-9]+(\.[0-9]+)? ?ms/);
    });

    it('still logs the duration when the handler throws', async () => {
        const lines: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
        });

        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users/999`, { headers: AUTH_HEADERS });

        expect(response.status).toBe(404);
        expect(lines.some((line) => /GET \/users\/999 — \d+(\.\d+)? ms/.test(line))).toBe(true);
    });

    it('maps NotFoundError to 404 with a meaningful message', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users/999`, { headers: AUTH_HEADERS });
        const body = await response.text();

        expect(response.status).toBe(404);
        expect(body).toMatch(/user not found/i);
        expect(JSON.parse(body)).toEqual({ message: 'User not found' });
    });

    it('maps an unexpected Error thrown by an interceptor to 500 without leaking the message or stack', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        @Controller('crash-after')
        class CrashAfterController {
            @Get()
            ok() {
                return { ok: true };
            }
        }

        const interceptor: Interceptor = {
            async intercept(_req, next) {
                await next();
                throw new Error('boom');
            },
        };

        const dispatcher = new Dispatcher(
            new Router([CrashAfterController]),
            new Container(),
            [],
            [interceptor],
            [new RequestIdMiddleware()],
        );

        server = createServer((req, res) => {
            void dispatcher.handle(req, res);
        });

        const baseUrl = await listen(server);
        const response = await fetch(`${baseUrl}/crash-after`);
        const body = await response.text();

        expect(response.status).toBe(500);
        expect(JSON.parse(body)).toEqual({ message: 'Internal Server Error' });
        expect(body).not.toMatch(/boom|at .*\.ts:/);
    });

    it('maps an unexpected Error to 500, logs it on the server and keeps it out of the response', async () => {
        const errors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            errors.push(args.map(String).join(' '));
        });

        @Controller('crash')
        class CrashController {
            @Get()
            crash() {
                throw new Error('boom');
            }
        }

        const dispatcher = new Dispatcher(
            new Router([CrashController]),
            new Container(),
            [],
            [new LoggingInterceptor()],
            [new RequestIdMiddleware()],
        );

        server = createServer((req, res) => {
            void dispatcher.handle(req, res);
        });

        const baseUrl = await listen(server);
        const requestId = 'crash-request-id';
        const response = await fetch(`${baseUrl}/crash`, {
            headers: { 'X-Request-Id': requestId },
        });
        const body = await response.text();

        expect(response.status).toBe(500);
        expect(JSON.parse(body)).toEqual({ message: 'Internal Server Error' });
        expect(body).not.toMatch(/boom|at .*\.ts:/);
        expect(response.headers.get('x-request-id')).toBe(requestId);
        expect(errors.some((line) => line.includes(requestId) && line.includes('boom'))).toBe(true);
    });

    it('propagates requestId from AsyncLocalStorage without passing it as an argument', async () => {
        expect(UserService.prototype.getRequestId.length).toBe(0);
        expect(UserRepository.prototype.findById.length).toBe(1);

        const lines: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
        });

        const requestId = 'client-request-id';
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users/1`, {
            headers: { ...AUTH_HEADERS, 'X-Request-Id': requestId },
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(response.headers.get('x-request-id')).toBe(requestId);
        expect(body.requestId).toBe(requestId);
        expect(lines).toContain(`[${requestId}] UserRepository.findById(1)`);
        expect(lines.some((line) => line.startsWith(`[${requestId}] GET /users/1`))).toBe(true);
    });

    it('sets X-Request-Id when the client did not send one', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users/1`, { headers: AUTH_HEADERS });

        expect(response.status).toBe(200);
        expect(response.headers.get('x-request-id')).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
    });

    it('echoes the client X-Request-Id even when the guard rejects the request', async () => {
        const requestId = 'forbidden-request-id';
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users/1`, {
            headers: { 'X-Request-Id': requestId },
        });

        expect(response.status).toBe(403);
        expect(response.headers.get('x-request-id')).toBe(requestId);
    });

    it('does not leak requestId between 10 concurrent requests', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);
        const ids = Array.from({ length: 10 }, () => `req-${randomUUID()}`);

        const results = await Promise.all(
            ids.map(async (requestId) => {
                const response = await fetch(`${baseUrl}/users/1`, {
                    headers: { ...AUTH_HEADERS, 'X-Request-Id': requestId },
                });
                const body = await response.json();

                return {
                    sent: requestId,
                    header: response.headers.get('x-request-id'),
                    bodyId: body.requestId as string,
                    status: response.status,
                };
            }),
        );

        expect(results.every((result) => result.status === 200)).toBe(true);

        for (const result of results) {
            expect(result.header).toBe(result.sent);
            expect(result.bodyId).toBe(result.sent);
        }

        expect(new Set(results.map((result) => result.header)).size).toBe(10);
        expect(new Set(results.map((result) => result.bodyId)).size).toBe(10);
    });
});
