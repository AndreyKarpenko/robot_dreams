import { ServerResponse } from 'node:http';

import { NotFoundError } from '../errors/not-found.error';
import { ValidationError } from '../errors/validation.error';
import { ValidationException } from '../pipes/validation.pipe';

export class ExceptionFilter {
    catch(error: unknown, res: ServerResponse): void {
        if (res.headersSent) {
            return;
        }

        if (error instanceof NotFoundError) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ message: error.message }));
            return;
        }

        if (error instanceof ValidationError || error instanceof ValidationException) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(error.errors));
            return;
        }

        if (error instanceof SyntaxError) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ message: 'Invalid JSON' }));
            return;
        }

        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: 'Internal Server Error' }));
    }
}
