import { afterEach, describe, expect, it } from 'vitest';

import { UserController } from '../src/controllers/UserController';
import { Controller, Get, Param } from '../src/decorators';
import { UserService, type TracedUser } from '../src/services';
import { sleep, startApp, type TestApp } from './helpers';

/** The handler waits before touching the service, so requests interleave. */
@Controller('slow')
class SlowController {
    constructor(private readonly users: UserService) {}

    @Get(':id')
    async read(@Param('id') id: string): Promise<TracedUser> {
        await sleep(5 + Math.random() * 20);

        return this.users.findById(id);
    }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('request context (AsyncLocalStorage)', () => {
    let app: TestApp;

    afterEach(async () => {
        await app.close();
    });

    it('returns a generated X-Request-Id when the client sent none', async () => {
        app = await startApp({ controllers: [UserController] });

        const response = await fetch(`${app.baseUrl}/users/1`);

        expect(response.headers.get('x-request-id')).toMatch(UUID);
    });

    it('returns the client id when the client sent one', async () => {
        app = await startApp({ controllers: [UserController] });

        const response = await fetch(`${app.baseUrl}/users/1`, {
            headers: { 'X-Request-Id': 'client-supplied-id' },
        });

        expect(response.headers.get('x-request-id')).toBe('client-supplied-id');
    });

    it('reaches a repository two levels below the handler without a parameter', async () => {
        app = await startApp({ controllers: [UserController] });

        const response = await fetch(`${app.baseUrl}/users/42`, {
            headers: { 'X-Request-Id': 'deep-read' },
        });
        const body = (await response.json()) as TracedUser;

        expect(body.requestId).toBe('deep-read');
        expect(app.logs).toContain('[deep-read] UserRepository.findById(42)');
    });

    it('keeps the same id on an error response', async () => {
        app = await startApp({ controllers: [UserController] });

        const response = await fetch(`${app.baseUrl}/users/999`, {
            headers: { 'X-Request-Id': 'failing-request' },
        });

        expect(response.headers.get('x-request-id')).toBe('failing-request');
        await expect(response.json()).resolves.toMatchObject({ requestId: 'failing-request' });
    });

    it('does not mix contexts across 10 concurrent requests', async () => {
        app = await startApp({ controllers: [SlowController] });

        const responses = await Promise.all(
            Array.from({ length: 10 }, (_, index) =>
                fetch(`${app.baseUrl}/slow/${index + 1}`, {
                    headers: { 'X-Request-Id': `req-${index + 1}` },
                }).then(async (response) => ({
                    header: response.headers.get('x-request-id'),
                    body: (await response.json()) as TracedUser,
                })),
            ),
        );

        responses.forEach(({ header, body }, index) => {
            const expected = `req-${index + 1}`;

            expect(header).toBe(expected);
            expect(body.id).toBe(String(index + 1));
            expect(body.requestId).toBe(expected);
        });

        const seen = responses.map(({ body }) => body.requestId);
        expect(new Set(seen).size).toBe(10);
    });

    it('logs every deep call under its own request id', async () => {
        app = await startApp({ controllers: [SlowController] });

        await Promise.all(
            Array.from({ length: 10 }, (_, index) =>
                fetch(`${app.baseUrl}/slow/${index + 1}`, {
                    headers: { 'X-Request-Id': `log-${index + 1}` },
                }),
            ),
        );

        Array.from({ length: 10 }, (_, index) => index + 1).forEach((id) => {
            expect(app.logs).toContain(`[log-${id}] UserRepository.findById(${id})`);
        });
    });
});
