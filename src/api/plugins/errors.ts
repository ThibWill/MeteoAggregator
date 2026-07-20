import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { ApiError, type ApiErrorCode } from '../errors.js';

interface ErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

const body = (code: ApiErrorCode, message: string, details?: unknown): ErrorBody => ({
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

/**
 * Single error shape for every failure. Nothing from Prisma or the SQL layer
 * reaches the client: unknown errors are logged with the request id and
 * rendered as a bare INTERNAL.
 */
export const errorsPlugin = fp(async (app) => {
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(body('NOT_FOUND', `route ${req.method} ${req.url} not found`));
  });

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      req.log.info({ err }, 'request validation failed');
      reply.code(400).send(
        body(
          'BAD_REQUEST',
          'request validation failed',
          err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        ),
      );
      return;
    }

    if (isResponseSerializationError(err)) {
      req.log.error({ err, reqId: req.id }, 'response serialization failed');
      reply.code(500).send(body('INTERNAL', 'internal server error'));
      return;
    }

    if (err instanceof ApiError) {
      req.log.info({ code: err.code, msg: err.message }, 'request rejected');
      reply.code(err.statusCode).send(body(err.code, err.message, err.details));
      return;
    }

    // @fastify/rate-limit and other fastify-native errors carry a usable status.
    const fastifyErr = err as { statusCode?: number; message?: string };
    const status = fastifyErr.statusCode ?? 500;
    if (status === 429) {
      reply.code(429).send(body('BAD_REQUEST', 'rate limit exceeded'));
      return;
    }
    if (status < 500) {
      reply.code(status).send(body('BAD_REQUEST', fastifyErr.message ?? 'bad request'));
      return;
    }

    req.log.error({ err, reqId: req.id }, 'unhandled error');
    reply.code(500).send(body('INTERNAL', 'internal server error'));
  });
});
