import { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { run } from '../context/request-context';

export interface Middleware {
    use(req: IncomingMessage, res: ServerResponse, next: () => Promise<void>): Promise<void>;
}

export class RequestIdMiddleware implements Middleware {
    async use(req: IncomingMessage, res: ServerResponse, next: () => Promise<void>): Promise<void> {
        const requestId =
            typeof req.headers['x-request-id'] === 'string'
                ? req.headers['x-request-id']
                : randomUUID();

        res.setHeader('X-Request-Id', requestId);

        await run(requestId, next);
    }
}
