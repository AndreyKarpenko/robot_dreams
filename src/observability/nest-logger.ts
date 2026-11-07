import type { LoggerService } from '@nestjs/common';
import type { Level } from 'pino';
import { layerLogger } from './logger';

const log = layerLogger('nest');

/** Nest's own lines (bootstrap, ExceptionsHandler) as JSON on stdout. */
export class PinoNestLogger implements LoggerService {
  log(message: unknown, ...params: unknown[]): void {
    write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    write('trace', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    write('fatal', message, params);
  }
}

function write(level: Level, message: unknown, params: unknown[]): void {
  const rest = [...params];
  // Nest appends the context name as the last string argument.
  const context =
    rest.length > 0 && typeof rest[rest.length - 1] === 'string'
      ? (rest.pop() as string)
      : undefined;
  const fields: Record<string, unknown> = {};
  if (context) {
    fields.context = context;
  }
  if (message instanceof Error) {
    fields.err = message;
    log[level](fields, message.message);
    return;
  }
  const stack = rest.find(
    (p): p is string => typeof p === 'string' && p.includes('\n'),
  );
  if (stack) {
    fields.stack = stack;
  }
  if (message !== null && typeof message === 'object') {
    log[level]({ ...fields, ...message });
    return;
  }
  log[level](fields, String(message));
}
