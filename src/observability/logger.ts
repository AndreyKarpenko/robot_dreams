import { isSpanContextValid, trace } from '@opentelemetry/api';
import pino from 'pino';
import { SERVICE_NAME } from './names';
import { requestContext } from './request-context';

const LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);

/**
 * Exact paths only. pino's redact does not search: `req.body.password` hides
 * that one key and nothing else, so `req.body.credentials.password` would be
 * printed. A new secret-bearing shape needs a new line here.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["proxy-authorization"]',
  'req.body.password',
  'req.body.refresh_token',
  'res.headers["set-cookie"]',
];

const level = process.env.LOG_LEVEL?.trim() || 'info';

export const logger = pino({
  // An unknown level would throw here, before env validation can name it.
  level: LEVELS.has(level) ? level : 'info',
  base: { service: SERVICE_NAME },
  messageKey: 'msg',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  mixin() {
    const fields: Record<string, string> = {};
    const span = trace.getActiveSpan()?.spanContext();
    if (span && isSpanContextValid(span)) {
      fields.trace_id = span.traceId;
      fields.span_id = span.spanId;
    }
    const ctx = requestContext.get();
    if (ctx) {
      fields.tenant = ctx.tenant;
      if (ctx.userId) {
        fields.user_id = ctx.userId;
      }
      if (ctx.idempotencyKey) {
        fields.idempotency_key = ctx.idempotencyKey;
      }
    }
    return fields;
  },
});

export function layerLogger(layer: string): pino.Logger {
  return logger.child({ layer });
}
