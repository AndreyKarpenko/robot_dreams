import { requestContext } from '../context/request-context';
import type { Middleware } from '../lifecycle';

/**
 * The id itself is created by the dispatcher, because the AsyncLocalStorage
 * scope has to be opened around the whole request — including the exception
 * filter. The middleware only mirrors it back to the client.
 */
export const requestIdMiddleware: Middleware = (_req, res, next) => {
    const requestId = requestContext.getRequestId();

    if (requestId) {
        res.setHeader('X-Request-Id', requestId);
    }

    return next();
};
