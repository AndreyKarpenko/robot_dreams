import type { Request, Response } from 'express';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

/**
 * Seconds. Fast reads land in the first buckets; checkout under a burst
 * queues on a 3-connection pool and reaches the hundreds of ms. The top
 * finite bound sits above the worst case the demo and TIMEOUT_MS allow, so
 * histogram_quantile never flattens against it. Rationale in README.
 */
export const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
];

const LABELS = ['method', 'route', 'status'] as const;

const METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

const requests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests by method, route template and status code',
  labelNames: LABELS,
  registers: [registry],
});

const duration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration by method, route template and status code',
  labelNames: LABELS,
  buckets: DURATION_BUCKETS,
  registers: [registry],
});

export function recordRequest(
  method: string,
  route: string,
  status: number,
  seconds: number,
): void {
  const labels = {
    method: METHODS.has(method) ? method : 'OTHER',
    route,
    status: String(status),
  };
  requests.inc(labels);
  duration.observe(labels, seconds);
}

export async function metricsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
