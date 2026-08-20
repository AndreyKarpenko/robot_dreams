import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Constructor } from './container';

/**
 * What every stage of the request lifecycle receives. It is deliberately the
 * same object for guards and interceptors: they differ by *when* they run and
 * by *what they may return*, not by what they can see.
 */
export type ExecutionContext = {
    req: IncomingMessage;
    res: ServerResponse;
    method: string;
    path: string;
    controller: Constructor;
    handler: string | symbol;
};

export type NextFunction = () => Promise<void>;

export type Middleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: NextFunction,
) => void | Promise<void>;

/** Runs before everything else in the handler chain and answers "let it in?". */
export interface CanActivate {
    canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

export type CallHandler = () => Promise<unknown>;

/** Wraps the handler call, so it observes both the input and the output. */
export interface Interceptor {
    intercept(context: ExecutionContext, next: CallHandler): unknown | Promise<unknown>;
}

export type RouteParamType = 'body' | 'param' | 'query';

export type ArgumentMetadata = {
    type: RouteParamType;
    name?: string;
};

/** Transforms/validates a single argument right before the handler gets it. */
export interface PipeTransform<TInput = unknown, TOutput = unknown> {
    transform(value: TInput, metadata: ArgumentMetadata): TOutput | Promise<TOutput>;
}

/** Anything the container can build, or an already built instance. */
export type Ref<T> = Constructor<T> | T;

export type GuardRef = Ref<CanActivate>;
export type InterceptorRef = Ref<Interceptor>;
export type PipeRef = Ref<PipeTransform>;

export type LogSink = (message: string) => void;
