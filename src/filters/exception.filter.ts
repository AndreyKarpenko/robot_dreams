import { ServerResponse } from 'node:http';

import { findRequestId } from '../context/request-context';
import { BadRequestError } from '../errors/bad-request.error';
import { ForbiddenError } from '../errors/forbidden.error';
import { NotFoundError } from '../errors/not-found.error';
import { ValidationError } from '../errors/validation.error';

export class ExceptionFilter {
    catch(error: unknown, res: ServerResponse): void {
        if (res.headersSent) {
            return;
        }

        if (error instanceof ValidationError) {
            this.send(res, 400, { message: error.message, errors: error.errors });
            return;
        }

        if (error instanceof BadRequestError) {
            this.send(res, 400, { message: error.message });
            return;
        }

        if (error instanceof ForbiddenError) {
            this.send(res, 403, { message: error.message });
            return;
        }

        if (error instanceof NotFoundError) {
            this.send(res, 404, { message: error.message });
            return;
        }

        const requestId = findRequestId();
        console.error(`[${requestId ?? 'no-request-id'}] Unhandled error`, error);

        this.send(res, 500, { message: 'Internal Server Error' });
    }

    private send(res: ServerResponse, statusCode: number, body: unknown): void {
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
    }
}
