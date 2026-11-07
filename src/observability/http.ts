import { AsyncResource } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { layerLogger } from './logger';
import { recordRequest } from './metrics';
import { UNTRACED_PATHS } from './names';
import { requestContext } from './request-context';

const log = layerLogger('http');

/** Anything that did not reach a route handler: 404s, parser rejects. */
const UNMATCHED = 'unmatched';

/**
 * Registered before the body parsers, so every request is counted — even
 * one that never reaches a handler. Opens the request context; the guard
 * fills in userId later.
 */
export function observeHttp(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const started = process.hrtime.bigint();
  const untraced = UNTRACED_PATHS.has(req.path);

  requestContext.run(
    {
      tenant: firstHeader(req, 'x-tenant-id') ?? 'public',
      idempotencyKey: firstHeader(req, 'idempotency-key'),
    },
    () => {
      // 'close' fires from the socket, outside this request's context.
      // bind() pins both the store and the active span to the listener.
      res.once(
        'close',
        AsyncResource.bind(() => {
          if (untraced) {
            return;
          }
          const seconds = Number(process.hrtime.bigint() - started) / 1e9;
          const status = res.writableFinished ? res.statusCode : 499;
          const route = routeTemplate(req);
          recordRequest(req.method, route, status, seconds);
          log.info(
            {
              req: {
                method: req.method,
                url: req.originalUrl,
                route,
                headers: req.headers,
                ...(log.isLevelEnabled('debug') && req.body !== undefined
                  ? { body: req.body as unknown }
                  : {}),
              },
              res: { statusCode: status },
              duration_ms: Math.round(seconds * 1000),
            },
            'request completed',
          );
        }),
      );
      next();
    },
  );
}

/** The matched template (`/orders/:id`), never the raw path. */
function routeTemplate(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string') {
    return UNMATCHED;
  }
  return `${req.baseUrl}${path}` || '/';
}

function firstHeader(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
