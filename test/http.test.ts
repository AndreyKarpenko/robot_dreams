import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';

import { UserController } from '../src/controllers/UserController';
import { Dispatcher } from '../src/dispatcher';
import { UserService } from '../src/services';
import { startApp, type TestApp } from './helpers';

const AUTHORIZED = { 'Content-Type': 'application/json', Authorization: 'Bearer token-123' };

describe('HTTP dispatcher', () => {
    let app: TestApp | undefined;

    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    it('finds a decorated route GET /users/:id', async () => {
        app = await startApp();

        const response = await fetch(`${app.baseUrl}/users/42`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ id: '42' });
    });

    it('substitutes @Param into the handler argument', async () => {
        app = await startApp();

        const body = await (await fetch(`${app.baseUrl}/users/42`)).text();

        expect(body).toMatch(/42/);
    });

    it('substitutes @Query into the handler argument', async () => {
        app = await startApp();

        const response = await fetch(`${app.baseUrl}/users?limit=2`);

        expect(response.status).toBe(200);

        const body = (await response.json()) as { limit: string; users: unknown[] };

        expect(body.limit).toBe('2');
        expect(body.users).toHaveLength(2);
    });

    it('parses @Body JSON and sends it to the handler', async () => {
        app = await startApp();

        const response = await fetch(`${app.baseUrl}/users`, {
            method: 'POST',
            headers: AUTHORIZED,
            body: JSON.stringify({ email: 'user@example.com' }),
        });

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toMatchObject({ email: 'user@example.com' });
    });

    it('rejects an invalid DTO with 400 and the offending fields', async () => {
        app = await startApp();

        const response = await fetch(`${app.baseUrl}/users`, {
            method: 'POST',
            headers: AUTHORIZED,
            body: JSON.stringify({ email: 'not-an-email', name: 'x' }),
        });

        const body = await response.text();

        expect(response.status).toBe(400);
        expect(body).toMatch(/email/);
        expect(JSON.parse(body)).toMatchObject({
            statusCode: 400,
            issues: expect.arrayContaining([
                expect.objectContaining({ field: 'email', message: expect.any(String) }),
                expect.objectContaining({ field: 'name' }),
            ]),
        });
    });

    it('hands the handler the parsed value, with undeclared fields stripped', async () => {
        app = await startApp();

        const service = app.container.resolve(UserService);
        const create = vi.spyOn(service, 'create');

        const response = await fetch(`${app.baseUrl}/users`, {
            method: 'POST',
            headers: AUTHORIZED,
            body: JSON.stringify({ email: 'user@example.com', isAdmin: true }),
        });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith({ email: 'user@example.com' });
    });

    it('resolves the controller through the IoC container as a singleton', async () => {
        app = await startApp();

        await fetch(`${app.baseUrl}/users/1`);

        const controller = app.container.resolve(UserController);
        const service = app.container.resolve(UserService);

        expect(app.container.resolve(UserController)).toBe(controller);
        expect(controller.userService).toBe(service);
        expect(service).toBe(app.container.resolve(UserService));
    });

    it('decodes percent-encoded @Param values', async () => {
        app = await startApp();
        const encoded = encodeURIComponent('Іван Петров');

        const response = await nodeRequest(app.baseUrl, `/users/${encoded}`);

        expect(response.status).toBe(404);
        expect(JSON.parse(response.body)).toMatchObject({
            message: 'User "Іван Петров" was not found',
        });
    });

    it('reassembles a UTF-8 body split across chunks', async () => {
        const json = JSON.stringify({ name: 'Ярослав' });
        const buffer = Buffer.from(json, 'utf8');
        const splitAt = buffer.indexOf(Buffer.from('Я', 'utf8')) + 1;
        const req = new PassThrough();

        expect(splitAt).toBeGreaterThan(1);
        const dispatcher = new Dispatcher({} as never, {} as never);
        const bodyPromise = (
            dispatcher as unknown as { readBody(req: IncomingMessage): Promise<string> }
        ).readBody(req as unknown as IncomingMessage);

        req.write(buffer.subarray(0, splitAt));
        req.write(buffer.subarray(splitAt));
        req.end();

        expect(JSON.parse(await bodyPromise)).toEqual({ name: 'Ярослав' });
    });
});

function nodeRequest(baseUrl: string, path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(baseUrl);
        const req = httpRequest(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path,
                method: 'GET',
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode ?? 0,
                        body: Buffer.concat(chunks).toString('utf8'),
                    }),
                );
            },
        );

        req.on('error', reject);
        req.end();
    });
}
