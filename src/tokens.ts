import type { LogSink } from './lifecycle';
import type { AuthService, UserService, AppService, PrismaService } from './services';

export type Token<T = unknown> = (string | symbol) & {
    readonly __type?: T;
};

export const APP_SERVICE = Symbol.for('APP_SERVICE') as Token<AppService>;
export const PRISMA_SERVICE = Symbol.for('PRISMA_SERVICE') as Token<PrismaService>;
export const AUTH_SERVICE = Symbol.for('AUTH_SERVICE') as Token<AuthService>;
export const USER_SERVICE = Symbol.for('USER_SERVICE') as Token<UserService>;

export const CONFIG = Symbol.for('CONFIG');
export const LOG_SINK = Symbol.for('LOG_SINK') as Token<LogSink>;

export const INJECTABLE_METADATA = Symbol.for('INJECTABLE_METADATA');
export const INJECT_METADATA = Symbol.for('INJECT_METADATA');
