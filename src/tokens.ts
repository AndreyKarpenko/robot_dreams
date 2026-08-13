import { AuthService, UserService, AppService, PrismaService } from './services'

export type Token<T> = symbol & {
    readonly __type?: T
}

export const APP_SERVICE = Symbol('APP_SERVICE') as Token<AppService>
export const PRISMA_SERVICE = Symbol('PRISMA_SERVICE') as Token<PrismaService>
export const AUTH_SERVICE = Symbol('AUTH_SERVICE') as Token<AuthService>
export const USER_SERVICE = Symbol('USER_SERVICE') as Token<UserService>

export const INJECTABLE_METADATA = Symbol('INJECTABLE_METADATA') as Token<UserService>