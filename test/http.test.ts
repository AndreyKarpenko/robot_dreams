import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { PassThrough } from 'node:stream';

import { createApp } from '../src/app';
import { UserController } from '../src/controllers/UserController';
import { Dispatcher } from '../src/dispatcher';
import { CreateUserDto } from '../src/dto/create-user.dto';
import { UserService } from '../src/services';

async function listen(server: Server): Promise<string> {
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();

    if (!address || typeof address === 'string') {
        throw new Error('Failed to bind HTTP server');
    }

    return `http://127.0.0.1:${address.port}`;
}

describe('HTTP dispatcher', () => {
    let server: Server | undefined;

    afterEach(async () => {
        if (!server) {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            server?.close((error) => (error ? reject(error) : resolve()));
        });

        server = undefined;
    });

    it('finds a decorated route GET /users/:id', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users/42`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: '42' });
    });

    it('substitutes @Param into the handler argument', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const body = await (await fetch(`${baseUrl}/users/42`)).text();

        expect(body).toMatch(/42/);
    });

    it('substitutes @Query into the handler argument', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users?limit=5`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ limit: '5' });
    });

    it('parses @Body JSON and sends it to the handler', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'user@example.com' }),
        });

        expect([200, 201]).toContain(response.status);
        await expect(response.json()).resolves.toEqual({ email: 'user@example.com' });
    });

    it('rejects an invalid DTO with 400 and field details', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'not-an-email' }),
        });

        const body = await response.text();

        expect(response.status).toBe(400);
        expect(body).toMatch(/email/);
        expect(JSON.parse(body)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: 'email',
                    constraints: expect.any(Object),
                }),
            ]),
        );
    });

    it('passes a CreateUserDto instance to the handler', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'user@example.com' }),
        });

        expect([200, 201]).toContain(response.status);

        const created = app.container.resolve(UserService).created[0];

        expect(created).toBeInstanceOf(CreateUserDto);
        expect(created.email).toBe('user@example.com');
    });

    it('resolves the controller through the IoC container as a singleton', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        await fetch(`${baseUrl}/users/1`);

        const controller = app.container.resolve(UserController);
        const service = app.container.resolve(UserService);

        expect(app.container.resolve(UserController)).toBe(controller);
        expect(controller.userService).toBe(service);
        expect(service).toBe(app.container.resolve(UserService));
    });

    it('decodes percent-encoded @Param values', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);
        const encoded = encodeURIComponent('Іван Петров');

        const response = await nodeRequest(baseUrl, `/users/${encoded}`);

        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ id: 'Іван Петров' });
    });

    it('strips undeclared DTO fields before the handler', async () => {
        const app = createApp();
        server = app.server;
        const baseUrl = await listen(server);

        const response = await fetch(`${baseUrl}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'user@example.com', isAdmin: true }),
        });

        expect(response.status).toBe(201);

        const created = app.container.resolve(UserService).created[0] as CreateUserDto & {
            isAdmin?: boolean;
        };

        expect(created).toBeInstanceOf(CreateUserDto);
        expect(created.email).toBe('user@example.com');
        expect(created).not.toHaveProperty('isAdmin');
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
