import { IncomingMessage, ServerResponse } from 'node:http';

import { Container } from './container';
import { RouteParamMetadata } from './decorators';
import { BadRequestError } from './errors/bad-request.error';
import { ForbiddenError } from './errors/forbidden.error';
import { NotFoundError } from './errors/not-found.error';
import { ExceptionFilter } from './filters/exception.filter';
import { Guard } from './guards/auth.guard';
import { Interceptor } from './interceptors/logging.interceptor';
import { Middleware } from './middleware/middleware';
import { ZodValidationPipe } from './pipes/zod-validation.pipe';
import { MatchedRoute, Router } from './router';

type ControllerInstance = Record<string | symbol, (...args: unknown[]) => unknown>;

export class Dispatcher {
    private exceptionFilter = new ExceptionFilter();

    constructor(
        private router: Router,
        private container: Container,
        private guards: Guard[],
        private interceptors: Interceptor[],
        private middlewares: Middleware[],
    ) {}

    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const chain = this.middlewares.reduceRight<() => Promise<void>>(
            (next, middleware) => () => middleware.use(req, res, next),
            () => this.route(req, res),
        );

        try {
            await chain();
        } catch (error) {
            this.exceptionFilter.catch(error, res);
        }
    }

    // The filter sits inside the middleware chain so that it still sees the request context;
    // handle() keeps an outer catch for middleware that fails before the context exists.
    private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
        try {
            const method = req.method ?? 'GET';
            const url = req.url ?? '/';
            const matched = this.router.match(method, url);

            if (!matched) {
                throw new NotFoundError(`Cannot ${method} ${url.split('?')[0]}`);
            }

            await this.handleLifecycle(matched, req, res);
        } catch (error) {
            this.exceptionFilter.catch(error, res);
        }
    }

    private async handleLifecycle(
        matched: MatchedRoute,
        req: IncomingMessage,
        res: ServerResponse,
    ): Promise<void> {
        for (const guard of this.guards) {
            const allowed = await guard.canActivate(req);

            if (!allowed) {
                throw new ForbiddenError();
            }
        }

        const invoke = this.interceptors.reduceRight<() => Promise<unknown>>(
            (next, interceptor) => () => interceptor.intercept(req, next),
            () => this.invoke(matched, req),
        );

        const resultValue = await invoke();

        res.statusCode = req.method === 'POST' ? 201 : 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(resultValue ?? null));
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

        const args: unknown[] = [];

        if (!parameters) {
            return args;
        }

        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const query: Record<string, string> = {};

        url.searchParams.forEach((value, key) => {
            query[key] = value;
        });

        let body: unknown;

        if (Object.values(parameters).some((parameter) => parameter.type === 'body')) {
            body = await this.parseBody(req);
        }

        for (const [index, parameter] of Object.entries(parameters)) {
            const parameterIndex = Number(index);

            if (parameter.type === 'param') {
                args[parameterIndex] = params[parameter.name!];
            }

            if (parameter.type === 'query') {
                args[parameterIndex] = query[parameter.name!];
            }

            if (parameter.type === 'body') {
                args[parameterIndex] = parameter.schema
                    ? new ZodValidationPipe(parameter.schema).transform(body)
                    : body;
            }
        }

        return args;
    }

    private async parseBody(req: IncomingMessage): Promise<unknown> {
        const rawBody = await this.readBody(req);

        if (!rawBody) {
            return {};
        }

        try {
            return JSON.parse(rawBody);
        } catch {
            throw new BadRequestError('Invalid JSON body');
        }
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
