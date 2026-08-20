import { requestContext } from '../context/request-context';
import { Inject, Injectable } from '../decorators';
import type { CallHandler, ExecutionContext, Interceptor, LogSink } from '../lifecycle';
import { LOG_SINK } from '../tokens';

/**
 * An interceptor wraps the handler call: code before, the call itself, code
 * after. `finally` keeps the measurement honest — a failed request is timed too.
 */
@Injectable()
export class LoggingInterceptor implements Interceptor {
    constructor(@Inject(LOG_SINK) private readonly log: LogSink) {}

    async intercept(context: ExecutionContext, next: CallHandler): Promise<unknown> {
        const startedAt = performance.now();

        try {
            return await next();
        } finally {
            const duration = (performance.now() - startedAt).toFixed(1);
            const requestId = requestContext.getRequestId() ?? 'no-request-id';

            this.log(`[${requestId}] ${context.method} ${context.path} — ${duration} ms`);
        }
    }
}
