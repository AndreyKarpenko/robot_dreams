import { IncomingMessage, ServerResponse } from 'node:http';

import { Container } from './container';
import { RouteParamMetadata } from './decorators';
import { ValidationException, ValidationPipe } from './pipes/validation.pipe';
import { MatchedRoute, Router } from './router';
import { Guard } from './guards/auth.guard';
import { Interceptor } from './interceptors/logging.interceptor';
import { ZodValidationPipe } from './pipes/zod-validation.pipe';

type ControllerInstance = Record<string | symbol, (...args: unknown[]) => unknown>;

export class Dispatcher {
    private validationPipe = new ValidationPipe();

    constructor(
        private router: Router,
        private container: Container,
        private guards: Guard[],
        private interceptors: Interceptor[],
    ) {}

    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const matched = this.router.match(req.method ?? 'GET', req.url ?? '/');

        if (!matched) {
            res.statusCode = 404;
            res.end('404 Not Found');
            return;
        }

        try {
            for (const guard of this.guards) {
                const allowed = await guard.canActivate(req);

                if (!allowed) {
                    res.statusCode = 403;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ message: 'Request Forbidden' }));
                    return;
                }
            }

            let next = () => this.invoke(matched, req);

            for (let interceptor of [...this.interceptors].reverse()) {
                const currentNext = next;
                next = () => interceptor.intercept(req, currentNext);
            }
            const resultValue = await next();

            res.statusCode = req.method === 'POST' ? 201 : 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(resultValue));
        } catch (error) {
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

    private async invoke(matched: MatchedRoute, req: IncomingMessage): Promise<unknown> {
        const controller = this.container.resolve(matched.route.controller) as ControllerInstance;
        const args = await this.normalizeArguments(matched, req);

        return controller[matched.route.handler](...args);
    }

    private async normalizeArguments(
        matched: MatchedRoute,
        req: IncomingMessage,
    ): Promise<unknown[]> {
        const { route, params } = matched;
        const parameters: Record<string, RouteParamMetadata> | undefined = Reflect.getMetadata(
            'parameters',
            route.controller.prototype,
            route.handler,
        );

        const paramTypes: unknown[] =
            Reflect.getMetadata('design:paramtypes', route.controller.prototype, route.handler) ??
            [];

        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const query: Record<string, string> = {};

        url.searchParams.forEach((value, key) => {
            query[key] = value;
        });

        let body: unknown;

        if (
            parameters &&
            Object.values(parameters).some((parameter) => parameter.type === 'body')
        ) {
            const rawBody = await this.readBody(req);
            body = rawBody ? JSON.parse(rawBody) : {};
        }

        const args: unknown[] = [];

        if (!parameters) {
            return args;
        }

        for (const [index, parameter] of Object.entries(parameters)) {
            const parameterIndex = Number(index);
            const metatype = paramTypes[parameterIndex] as
                (new (...args: unknown[]) => unknown) | undefined;

            if (parameter.type === 'param') {
                args[parameterIndex] = params[parameter.name!];
            }

            if (parameter.type === 'query') {
                args[parameterIndex] = query[parameter.name!];
            }

            if (parameter.type === 'body') {
                if (parameter.schema) {
                    const pipe = new ZodValidationPipe(parameter.schema);
                    args[parameterIndex] = pipe.transform(body);
                } else {
                    args[parameterIndex] = await this.validationPipe.transform(body, metatype);
                }
            }
        }

        return args;
    }

    private readBody(req: IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];

            req.on('data', (chunk: Buffer | string) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });

            req.on('end', () => {
                resolve(Buffer.concat(chunks).toString('utf8'));
            });

            req.on('error', reject);
        });
    }
}
