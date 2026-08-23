import 'reflect-metadata';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';

import { Container } from './container';
import { UserController } from './controllers/UserController';
import { Dispatcher } from './dispatcher';
import { Router } from './router';

import { AuthGuard } from './guards/auth.guard';
import { LoggingInterceptor, LoggingTestInterceptor } from './interceptors/logging.interceptor';

export function createApp(container = new Container()): {
    container: Container;
    router: Router;
    dispatcher: Dispatcher;
    server: Server;
} {
    const router = new Router([UserController]);
    const dispatcher = new Dispatcher(
        router,
        container,
        [new AuthGuard()],
        [new LoggingInterceptor(), new LoggingTestInterceptor()],
    );
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void dispatcher.handle(req, res);
    });

    return { container, router, dispatcher, server };
}
