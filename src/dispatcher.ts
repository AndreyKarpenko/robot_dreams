import { IncomingMessage, ServerResponse } from 'node:http';

import { Container } from './container';
import { RouteParamMetadata } from './decorators';
import { ValidationException, ValidationPipe } from './pipes/validation.pipe';
import { Router } from './router';

export class Dispatcher {
    private validationPipe = new ValidationPipe();

    constructor(
        private router: Router,
        private container: Container,
    ) {}

    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const result = this.router.match(req.method ?? 'GET', req.url ?? '/');

        if (!result) {
            res.statusCode = 404;
            res.end('404 Not Found');
            return;
        }

        const { route, params } = result;
        const controller = this.container.resolve(route.controller) as Record<
            string | symbol,
            (...args: unknown[]) => unknown
        >;

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

        try {
            if (
                parameters &&
                Object.values(parameters).some((parameter) => parameter.type === 'body')
            ) {
                const rawBody = await this.readBody(req);
                body = rawBody ? JSON.parse(rawBody) : {};
            }

            const args: unknown[] = [];

            if (parameters) {
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
                        args[parameterIndex] = await this.validationPipe.transform(body, metatype);
                    }
                }
            }

            const resultValue = await controller[route.handler](...args);

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

    private readBody(req: IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';

            req.on('data', (chunk) => {
                body += chunk;
            });

            req.on('end', () => {
                resolve(body);
            });

            req.on('error', reject);
        });
    }
}
