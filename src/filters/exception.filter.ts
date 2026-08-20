import type { ServerResponse } from 'node:http';

import { requestContext } from '../context/request-context';
import { Inject, Injectable } from '../decorators';
import { HttpError, NotFoundError, ValidationError } from '../errors';
import type { LogSink } from '../lifecycle';
import { LOG_SINK } from '../tokens';

type ErrorResponse = {
    statusCode: number;
    error: string;
    message: string;
    issues?: unknown;
};

const STATUS_TEXT: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
};

function statusText(statusCode: number): string {
    return STATUS_TEXT[statusCode] ?? 'Error';
}

/**
 * The last stage of the lifecycle: it turns anything thrown anywhere in the
 * chain — middleware, guard, interceptor, pipe or handler — into a response.
 */
@Injectable()
export class ExceptionFilter {
    constructor(@Inject(LOG_SINK) private readonly log: LogSink) {}

    catch(error: unknown, res: ServerResponse): void {
        const body = this.toResponse(error);
        const requestId = requestContext.getRequestId();

        if (res.headersSent) {
            res.end();
            return;
        }

        res.statusCode = body.statusCode;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ...body, requestId }));
    }

    private toResponse(error: unknown): ErrorResponse {
        if (error instanceof ValidationError) {
            return {
                statusCode: 400,
                error: statusText(400),
                message: error.message,
                issues: error.issues,
            };
        }

        if (error instanceof NotFoundError) {
            return { statusCode: 404, error: statusText(404), message: error.message };
        }

        if (error instanceof HttpError) {
            return {
                statusCode: error.statusCode,
                error: statusText(error.statusCode),
                message: error.message,
            };
        }

        if (error instanceof SyntaxError) {
            return { statusCode: 400, error: statusText(400), message: 'Invalid JSON body' };
        }

        // Unknown failure: the details stay in the server log, the client gets
        // a bare 500 — no message from the error, no stack trace.
        const requestId = requestContext.getRequestId() ?? 'no-request-id';
        this.log(`[${requestId}] unhandled error: ${describe(error)}`);

        return { statusCode: 500, error: statusText(500), message: statusText(500) };
    }
}

function describe(error: unknown): string {
    return error instanceof Error
        ? (error.stack ?? `${error.name}: ${error.message}`)
        : String(error);
}
