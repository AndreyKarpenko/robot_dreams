import 'reflect-metadata';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';

import { Container } from './container';
import { UserController } from './controllers/UserController';
import { Dispatcher } from './dispatcher';
import { Router } from './router';

export function createApp(container = new Container()): {
    container: Container;
    router: Router;
    dispatcher: Dispatcher;
    server: Server;
} {
    const router = new Router([UserController]);
    const dispatcher = new Dispatcher(router, container);
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void dispatcher.handle(req, res);
    });

    return { container, router, dispatcher, server };
}
