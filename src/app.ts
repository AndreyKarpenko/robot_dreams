import 'reflect-metadata';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';

import { Constructor, Container } from './container';
import { UserController } from './controllers/UserController';
import { Dispatcher } from './dispatcher';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import type { GuardRef, InterceptorRef, LogSink, Middleware } from './lifecycle';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { Router } from './router';
import { LOG_SINK } from './tokens';

export type AppOptions = {
    container?: Container;
    controllers?: Constructor[];
    /** Global stages, prepended by the framework's own defaults. */
    middlewares?: Middleware[];
    guards?: GuardRef[];
    interceptors?: InterceptorRef[];
    logger?: LogSink;
};

export type App = {
    container: Container;
    router: Router;
    dispatcher: Dispatcher;
    server: Server;
};

export function createApp(options: AppOptions = {}): App {
    const container = options.container ?? new Container();

    container.registerValue(
        LOG_SINK,
        options.logger ?? ((message: string) => console.log(message)),
    );

    const router = new Router(options.controllers ?? [UserController]);
    const dispatcher = new Dispatcher(router, container, {
        middlewares: [requestIdMiddleware, ...(options.middlewares ?? [])],
        guards: options.guards ?? [],
        interceptors: [LoggingInterceptor, ...(options.interceptors ?? [])],
    });

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void dispatcher.handle(req, res);
    });

    return { container, router, dispatcher, server };
}
