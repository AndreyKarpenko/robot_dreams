import { IncomingMessage, ServerResponse } from 'node:http';

import { Constructor, Container } from './container';
import { requestContext } from './context/request-context';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, RouteParamMetadata } from './decorators';
import { ForbiddenError, NotFoundError } from './errors';
import { ExceptionFilter } from './filters/exception.filter';
import type {
    CallHandler,
    ExecutionContext,
    GuardRef,
    InterceptorRef,
    Middleware,
    PipeRef,
    Ref,
} from './lifecycle';
import { MatchedRoute, Router } from './router';

type ControllerInstance = Record<string | symbol, (...args: unknown[]) => unknown>;

export type DispatcherOptions = {
    middlewares?: Middleware[];
    guards?: GuardRef[];
    interceptors?: InterceptorRef[];
};

/**
 * One request, one pass:
 *
 *   middleware -> guard -> interceptor(before) -> pipe -> handler
 *              -> interceptor(after) -> exception filter
 *
 * The whole pass runs inside a single AsyncLocalStorage scope, so the request
 * id is reachable from any depth without being threaded through arguments.
 */
export class Dispatcher {
    constructor(
        private router: Router,
        private container: Container,
        private options: DispatcherOptions = {},
    ) {}

    handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const store = requestContext.createStore(req.headers['x-request-id']);

        return requestContext.run(store, () => this.runLifecycle(req, res));
    }

    private async runLifecycle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        try {
            await this.runMiddlewares(req, res);

            // A middleware that answered by itself (or never called next())
            // ends the request: nothing downstream should run.
            if (res.writableEnded) {
                return;
            }

            const method = req.method ?? 'GET';
            const path = (req.url ?? '/').split('?')[0];
            const matched = this.router.match(method, req.url ?? '/');

            if (!matched) {
                throw new NotFoundError(`Cannot ${method} ${path}`);
            }

            const context: ExecutionContext = {
                req,
                res,
                method,
                path,
                controller: matched.route.controller,
                handler: matched.route.handler,
            };

            await this.runGuards(context);

            const result = await this.runInterceptors(context, () => this.invoke(matched, req));

            this.send(res, method, result);
        } catch (error) {
            this.container.resolve(ExceptionFilter).catch(error, res);
        }
    }

    private async runMiddlewares(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const middlewares = this.options.middlewares ?? [];
        let lastCalled = -1;

        const dispatch = async (index: number): Promise<void> => {
            if (index <= lastCalled) {
                throw new Error('next() was called more than once by a middleware');
            }

            lastCalled = index;
            const middleware = middlewares[index];

            if (!middleware) {
                return;
            }

            await middleware(req, res, () => dispatch(index + 1));
        };

        await dispatch(0);
    }

    private async runGuards(context: ExecutionContext): Promise<void> {
        const refs = [
            ...(this.options.guards ?? []),
            ...this.collect<GuardRef>(GUARDS_METADATA, context),
        ];

        for (const ref of refs) {
            const allowed = await this.resolveRef(ref).canActivate(context);

            if (!allowed) {
                throw new ForbiddenError(`Access denied for ${context.method} ${context.path}`);
            }
        }
    }

    private runInterceptors(context: ExecutionContext, handler: CallHandler): Promise<unknown> {
        const refs = [
            ...(this.options.interceptors ?? []),
            ...this.collect<InterceptorRef>(INTERCEPTORS_METADATA, context),
        ];

        // Fold right, so the first interceptor ends up outermost and sees the
        // request first and the response last.
        const chain = refs.reduceRight<CallHandler>((next, ref) => {
            return () => Promise.resolve(this.resolveRef(ref).intercept(context, next));
        }, handler);

        return chain();
    }

    private collect<T>(metadataKey: symbol, context: ExecutionContext): T[] {
        const onController: T[] = Reflect.getMetadata(metadataKey, context.controller) ?? [];
        const onHandler: T[] =
            Reflect.getMetadata(metadataKey, context.controller.prototype, context.handler) ?? [];

        return [...onController, ...onHandler];
    }

    private resolveRef<T>(ref: Ref<T>): T {
        return typeof ref === 'function' ? this.container.resolve(ref as Constructor<T>) : ref;
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

        const needsBody = Object.values(parameters).some((parameter) => parameter.type === 'body');
        let body: unknown;

        if (needsBody) {
            const rawBody = await this.readBody(req);
            body = rawBody ? JSON.parse(rawBody) : {};
        }

        for (const [index, parameter] of Object.entries(parameters)) {
            const parameterIndex = Number(index);
            const raw =
                parameter.type === 'body'
                    ? body
                    : parameter.type === 'param'
                      ? params[parameter.name!]
                      : query[parameter.name!];

            args[parameterIndex] = await this.applyPipes(raw, parameter);
        }

        return args;
    }

    private async applyPipes(value: unknown, parameter: RouteParamMetadata): Promise<unknown> {
        const pipes: PipeRef[] = parameter.pipes ?? [];
        let current = value;

        for (const ref of pipes) {
            current = await this.resolveRef(ref).transform(current, {
                type: parameter.type,
                name: parameter.name,
            });
        }

        return current;
    }

    private send(res: ServerResponse, method: string, result: unknown): void {
        if (result === undefined) {
            res.statusCode = 204;
            res.end();
            return;
        }

        res.statusCode = method === 'POST' ? 201 : 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
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
