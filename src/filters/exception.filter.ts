import { ServerResponse } from 'node:http';
import { ValidationException } from '../pipes/validation.pipe';
import { z } from 'zod';
import { NotFoundError } from '../errors/not-found.error';

export class ExceptionFilter {
    catch(error: unknown, res: ServerResponse): void {
        if (error instanceof NotFoundError) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ message: error.message }));
            return;
        }

        if (error instanceof z.ZodError) {
            if (error instanceof z.ZodError) {
                const errors = error.issues.map((issue) => ({
                    field: issue.path.join('.'),
                    message: issue.message,
                }));
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(errors));
                return;
            }
        }

        if (error instanceof ValidationException) {
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
