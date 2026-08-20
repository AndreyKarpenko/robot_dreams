import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Body, Controller, Get, Post, UseGuards } from '../src/decorators';
import { AuthGuard } from '../src/guards/auth.guard';
import type { CanActivate, Interceptor, Middleware, PipeTransform } from '../src/lifecycle';
import { ZodValidationPipe } from '../src/pipes/zod-validation.pipe';
import { startApp, type TestApp } from './helpers';

const calls: string[] = [];
let handlerCalls = 0;

const schema = z.object({ email: z.email() });

const recordingMiddleware: Middleware = (_req, _res, next) => {
    calls.push('middleware');
    return next();
};

const recordingGuard: CanActivate = {
    canActivate: () => {
        calls.push('guard');
        return true;
    },
};

const recordingInterceptor: Interceptor = {
    async intercept(_context, next) {
        calls.push('interceptor:before');
        const result = await next();
        calls.push('interceptor:after');

        return result;
    },
};

const recordingPipe: PipeTransform = {
    transform: (value) => {
        calls.push('pipe');
        return value;
    },
};

@Controller('lifecycle')
@UseGuards(recordingGuard)
class LifecycleController {
    @Post()
    create(@Body(recordingPipe, new ZodValidationPipe(schema)) dto: z.infer<typeof schema>) {
        calls.push('handler');
        return dto;
    }
}

@Controller('protected')
@UseGuards(AuthGuard)
class ProtectedController {
    @Get()
    read() {
        handlerCalls += 1;
        return { ok: true };
    }

    @Post()
    create(@Body(new ZodValidationPipe(schema)) dto: z.infer<typeof schema>) {
        handlerCalls += 1;
        return dto;
    }
}

describe('request lifecycle', () => {
    let app: TestApp;

    beforeEach(async () => {
        calls.length = 0;
        handlerCalls = 0;
        app = await startApp({
            controllers: [LifecycleController, ProtectedController],
            middlewares: [recordingMiddleware],
            interceptors: [recordingInterceptor],
        });
    });

    afterEach(async () => {
        await app.close();
    });

    it('runs the stages in exactly one order', async () => {
        const response = await fetch(`${app.baseUrl}/lifecycle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'user@example.com' }),
        });

        expect(response.status).toBe(201);
        expect(calls).toEqual([
            'middleware',
            'guard',
            'interceptor:before',
            'pipe',
            'handler',
            'interceptor:after',
        ]);
    });

    it('stops the chain when a middleware answers by itself', async () => {
        await app.close();
        app = await startApp({
            controllers: [ProtectedController],
            middlewares: [
                (_req, res) => {
                    res.statusCode = 503;
                    res.end('maintenance');
                },
            ],
        });

        const response = await fetch(`${app.baseUrl}/protected`, {
            headers: { Authorization: 'Bearer token-123' },
        });

        expect(response.status).toBe(503);
        expect(await response.text()).toBe('maintenance');
        expect(handlerCalls).toBe(0);
    });

    it('blocks the request in the guard: 403 and the handler never runs', async () => {
        const response = await fetch(`${app.baseUrl}/protected`);

        expect(response.status).toBe(403);
        expect(handlerCalls).toBe(0);
        await expect(response.json()).resolves.toMatchObject({ statusCode: 403 });
    });

    it('lets the request through when Authorization is present', async () => {
        const response = await fetch(`${app.baseUrl}/protected`, {
            headers: { Authorization: 'Bearer token-123' },
        });

        expect(response.status).toBe(200);
        expect(handlerCalls).toBe(1);
    });

    it('rejects a malformed Authorization header', async () => {
        const response = await fetch(`${app.baseUrl}/protected`, {
            headers: { Authorization: 'Basic ' },
        });

        expect(response.status).toBe(403);
        expect(handlerCalls).toBe(0);
    });

    it('runs the guard before validation: no auth wins over an invalid body', async () => {
        const response = await fetch(`${app.baseUrl}/protected`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'not-an-email' }),
        });

        expect(response.status).toBe(403);
        expect(handlerCalls).toBe(0);
    });
});
