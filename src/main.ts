import 'reflect-metadata'

import { APP_SERVICE, AUTH_SERVICE, USER_SERVICE, PRISMA_SERVICE } from './tokens'
import { AuthService, UserService, AppService, PrismaService } from './services'
import { Container } from './container'

const container = new Container()

container.register(PRISMA_SERVICE, PrismaService)
container.register(USER_SERVICE, UserService)
container.register(AUTH_SERVICE, AuthService)
container.register(APP_SERVICE, AppService)

const app = container.get(APP_SERVICE)

app.start()