import { createServer, ServerResponse, IncomingMessage } from 'node:http';
import 'reflect-metadata';

import { APP_SERVICE, AUTH_SERVICE, USER_SERVICE, PRISMA_SERVICE } from './tokens';
import { AuthService, UserService, AppService, PrismaService } from './services';
import { Container } from './container';
import { Router } from './router';

import { UserController } from './controllers/UserController';
import { Dispatcher } from './dispatcher';

const container = new Container();

container.register(PRISMA_SERVICE, PrismaService);
container.register(USER_SERVICE, UserService);
container.register(AUTH_SERVICE, AuthService);
container.register(APP_SERVICE, AppService);

const router = new Router([UserController]);

const dispatcher = new Dispatcher(router, container);

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    dispatcher.handle(req, res);
});

server.listen(3000);
