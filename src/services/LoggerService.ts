import { requestContext } from '../context/request-context';
import { Inject, Injectable } from '../decorators';
import type { LogSink } from '../lifecycle';
import { LOG_SINK } from '../tokens';

/**
 * The logger takes no id parameter: it reads the current request from the
 * AsyncLocalStorage store, no matter how deep in the call stack it is used.
 */
@Injectable()
export class LoggerService {
    constructor(@Inject(LOG_SINK) private readonly sink: LogSink) {}

    log(message: string): void {
        const requestId = requestContext.getRequestId() ?? 'no-request-id';

        this.sink(`[${requestId}] ${message}`);
    }
}
