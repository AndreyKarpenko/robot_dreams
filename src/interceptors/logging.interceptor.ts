import { IncomingMessage } from 'node:http';

export interface Interceptor {
    intercept(req: IncomingMessage, next: () => Promise<unknown>): Promise<unknown>;
}

export class LoggingInterceptor implements Interceptor {
    async intercept(req: IncomingMessage, next: () => Promise<unknown>): Promise<unknown> {
        const now = performance.now();

        const res = await next();

        const elapsed = performance.now() - now;

        console.log(`${req.method} ${req.url} — ${elapsed.toFixed(1)} ms`);

        return res;
    }
}

export class LoggingTestInterceptor implements Interceptor {
    async intercept(req: IncomingMessage, next: () => Promise<unknown>): Promise<unknown> {
        console.log('Test before');

        const res = await next();

        console.log('Test after');

        return res;
    }
}
