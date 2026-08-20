import { afterEach, describe, expect, it } from 'vitest';

import { UserController } from '../src/controllers/UserController';
import { Controller, Get } from '../src/decorators';
import { NotFoundError } from '../src/errors';
import type { Interceptor, Middleware } from '../src/lifecycle';
import { sleep, startApp, type TestApp } from './helpers';

@Controller('boom')
class BoomController {
    @Get()
    read(): never {
        throw new Error('boom');
    }

    @Get('async')
    async readAsync(): Promise<never> {
        await sleep(1);
        throw new Error('boom');
    }

    @Get('domain')
    readDomain(): never {
        throw new NotFoundError('User "missing" was not found');
    }
}

const throwingInterceptor: Interceptor = {
    intercept: () => {
        throw new Error('boom from interceptor');
    },
};

const throwingMiddleware: Middleware = () => {
    throw new Error('boom from middleware');
};

describe('exception filter', () => {
    let app: TestApp;

    afterEach(async () => {
        await app.close();
    });

    it('turns an unexpected error into a bare 500', async () => {
        app = await startApp({ controllers: [BoomController] });

        const response = await fetch(`${app.baseUrl}/boom`);
        const body = await response.text();

        expect(response.status).toBe(500);
        expect(body).not.toMatch(/boom|at .*\.ts:/);
        expect(JSON.parse(body)).toMatchObject({
            statusCode: 500,
            message: 'Internal Server Error',
        });
    });

    it('catches a rejection thrown after an await', async () => {
        app = await startApp({ controllers: [BoomController] });

        const response = await fetch(`${app.baseUrl}/boom/async`);

        expect(response.status).toBe(500);
        expect(await response.text()).not.toMatch(/boom|at .*\.ts:/);
    });

    it('keeps the stack trace on the server side only', async () => {
        app = await startApp({ controllers: [BoomController] });

        await fetch(`${app.baseUrl}/boom`);

        expect(app.logs.join('\n')).toMatch(/unhandled error: Error: boom/);
    });

    it('maps a domain NotFoundError to 404 with a meaningful message', async () => {
        app = await startApp({ controllers: [BoomController] });

        const response = await fetch(`${app.baseUrl}/boom/domain`);

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            statusCode: 404,
            message: 'User "missing" was not found',
        });
    });

    it('maps a repository NotFoundError raised two levels below the handler', async () => {
        app = await startApp({ controllers: [UserController] });

        const response = await fetch(`${app.baseUrl}/users/999`);

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            statusCode: 404,
            message: 'User "999" was not found',
        });
    });

    it('answers 404 for an unknown route', async () => {
        app = await startApp({ controllers: [UserController] });

        const response = await fetch(`${app.baseUrl}/nothing/here`);

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            message: 'Cannot GET /nothing/here',
        });
    });

    it('catches what an interceptor throws', async () => {
        app = await startApp({
            controllers: [UserController],
            interceptors: [throwingInterceptor],
        });

        const response = await fetch(`${app.baseUrl}/users/1`);

        expect(response.status).toBe(500);
        expect(await response.text()).not.toMatch(/boom/);
    });

    it('catches what a middleware throws', async () => {
        app = await startApp({
            controllers: [UserController],
            middlewares: [throwingMiddleware],
        });

        const response = await fetch(`${app.baseUrl}/users/1`);

        expect(response.status).toBe(500);
        expect(await response.text()).not.toMatch(/boom/);
    });

    it('rejects a malformed JSON body with 400', async () => {
        app = await startApp({ controllers: [UserController] });

        const response = await fetch(`${app.baseUrl}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
            body: '{ not json',
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ message: 'Invalid JSON body' });
    });
});
