import { IncomingMessage } from 'node:http';

import { findRequestId } from '../context/request-context';

export interface Interceptor {
    intercept(req: IncomingMessage, next: () => Promise<unknown>): Promise<unknown>;
}

export class LoggingInterceptor implements Interceptor {
    async intercept(req: IncomingMessage, next: () => Promise<unknown>): Promise<unknown> {
        const startedAt = performance.now();

        try {
            return await next();
        } finally {
            const elapsed = performance.now() - startedAt;
            const path = (req.url ?? '/').split('?')[0];
            const requestId = findRequestId();
            const prefix = requestId ? `[${requestId}] ` : '';

            console.log(`${prefix}${req.method} ${path} — ${elapsed.toFixed(1)} ms`);
        }
    }
}
