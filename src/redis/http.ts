import type { NextFunction, Request, Response } from 'express';
import type Redis from 'ioredis';
import { SessionStore } from './session-store';
import { rateLimitStatus, SlidingWindowLimiter } from './sliding-window';

export function sessionMiddleware(redis: Redis) {
  const sessions = new SessionStore(redis);
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = req.header('x-session-id');
    if (!id) {
      next();
      return;
    }
    void sessions
      .read(id)
      .then((session) => {
        if (session) {
          (req as Request & { sessionUserId?: string }).sessionUserId =
            session.userId;
        }
        next();
      })
      .catch(next);
  };
}

export function rateLimitMiddleware(redis: Redis) {
  const limiter = new SlidingWindowLimiter(redis, 100, 10_000);
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    void limiter
      .consume(`ip:${ip}`)
      .then((decision) => {
        const status = rateLimitStatus(decision, (name, value) => {
          res.setHeader(name, value);
        });
        if (status === 200) {
          next();
          return;
        }
        res.status(status).json({ message: 'Too many requests' });
      })
      .catch(next);
  };
}
