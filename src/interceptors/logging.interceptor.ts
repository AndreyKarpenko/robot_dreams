import { IncomingMessage } from 'node:http';

export interface Interceptor {
    intercept(req: IncomingMessage, next: () => Promise<unknown>): Promise<unknown>;
}

export class LoggingInterceptor implements Interceptor {
    async intercept(req: IncomingMessage, next: () => Promise<unknown>): Promise<unknown> {
        const startedAt = performance.now();
        const result = await next();
        const elapsed = performance.now() - startedAt;
        const path = (req.url ?? '/').split('?')[0];

        console.log(`${req.method} ${path} — ${elapsed.toFixed(1)} ms`);

        return result;
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
