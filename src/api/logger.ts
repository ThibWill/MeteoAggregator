import { logger, type Logger } from '../lib/logger.js';

/**
 * Fastify calls its logger pino-style — `log.info(obj, msg)` or `log.info(msg)`
 * — while `src/lib/logger.ts` takes `(msg, fields)`. This adapter bridges the
 * two so the API and the batch tasks emit one JSON format.
 */
export interface FastifyCompatibleLogger {
  fatal(obj: unknown, msg?: string, ...args: unknown[]): void;
  error(obj: unknown, msg?: string, ...args: unknown[]): void;
  warn(obj: unknown, msg?: string, ...args: unknown[]): void;
  info(obj: unknown, msg?: string, ...args: unknown[]): void;
  debug(obj: unknown, msg?: string, ...args: unknown[]): void;
  trace(obj: unknown, msg?: string, ...args: unknown[]): void;
  child(bindings: Record<string, unknown>): FastifyCompatibleLogger;
  level: string;
  silent(): void;
}

function normalize(obj: unknown, msg?: string): [string, Record<string, unknown> | undefined] {
  if (typeof obj === 'string') return [obj, undefined];
  if (obj instanceof Error) {
    return [msg ?? obj.message, { error: obj.message, stack: obj.stack }];
  }
  if (obj && typeof obj === 'object') {
    const fields = { ...(obj as Record<string, unknown>) };
    if (fields.err instanceof Error) {
      const e = fields.err;
      fields.error = e.message;
      fields.stack = e.stack;
      delete fields.err;
    }
    return [msg ?? '', fields];
  }
  return [msg ?? String(obj ?? ''), undefined];
}

export function toFastifyLogger(base: Logger = logger): FastifyCompatibleLogger {
  const wrap = (l: Logger): FastifyCompatibleLogger => ({
    // `src/lib/logger.ts` has no fatal/trace level; map onto the nearest.
    fatal: (o, m) => l.error(...normalize(o, m)),
    error: (o, m) => l.error(...normalize(o, m)),
    warn: (o, m) => l.warn(...normalize(o, m)),
    info: (o, m) => l.info(...normalize(o, m)),
    debug: (o, m) => l.debug(...normalize(o, m)),
    trace: (o, m) => l.debug(...normalize(o, m)),
    child: (b) => wrap(l.child(b)),
    level: 'info',
    silent: () => {},
  });
  return wrap(base);
}
