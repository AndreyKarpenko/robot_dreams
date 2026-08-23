import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { Container } from '../src/container';
import { Controller, Get } from '../src/decorators';
import { UserController } from '../src/controllers/UserController';
import { Dispatcher } from '../src/dispatcher';
import { RequestIdMiddleware } from '../src/middleware/middleware';
import { Router } from '../src/router';
import { UserService } from '../src/services';
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
        await expect(response.json()).resolves.toEqual({ message: 'Request Forbidden' });
        expect(handler).not.toHaveBeenCalled();
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

    it('maps an unexpected Error to 500 without leaking the message or stack', async () => {
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
            [],
            [new RequestIdMiddleware()],
        );

        server = createServer((req, res) => {
            void dispatcher.handle(req, res);
        });

        const baseUrl = await listen(server);
        const response = await fetch(`${baseUrl}/crash`);
        const body = await response.text();

        expect(response.status).toBe(500);
        expect(JSON.parse(body)).toEqual({ message: 'Internal Server Error' });
        expect(body).not.toMatch(/boom|at .*\.ts:/);
    });

    it('propagates requestId from AsyncLocalStorage without passing it as an argument', async () => {
        expect(UserService.prototype.getRequestId.length).toBe(0);

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
