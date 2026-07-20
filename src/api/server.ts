import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { loadEnv } from '../config/env.js';
import { toFastifyLogger } from './logger.js';
import { prismaPlugin } from './plugins/prisma.js';
import { errorsPlugin } from './plugins/errors.js';
import { authPlugin } from './plugins/auth.js';
import { openapiPlugin } from './plugins/openapi.js';
import { healthRoutes } from './routes/health.js';
import { townRoutes } from './routes/towns.js';
import { sourceRoutes } from './routes/sources.js';
import { timeRangeRoutes } from './routes/timeRanges.js';
import { measurementRoutes } from './routes/measurements.js';
import { comparisonRoutes } from './routes/comparison.js';
import { reliabilityRoutes } from './routes/reliability.js';
import { reportRoutes } from './routes/reports.js';
import { adminRoutes } from './routes/admin.js';

function corsOrigin(raw: string): true | string[] {
  const trimmed = raw.trim();
  if (trimmed === '*') return true;
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Assembles plugins and routes. Does not listen — `start.ts` and tests do. */
export async function buildServer() {
  const env = loadEnv();

  const app = Fastify({
    loggerInstance: toFastifyLogger(),
    // Fastify's own request/response lines are suppressed; the onResponse hook
    // below emits a single line in the batch tasks' format instead.
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorsPlugin);
  await app.register(prismaPlugin);
  await app.register(cors, { origin: corsOrigin(env.API_CORS_ORIGINS) });
  await app.register(compress, { global: true });
  await app.register(rateLimit, {
    max: env.API_RATE_LIMIT_PER_MIN,
    timeWindow: '1 minute',
  });
  await app.register(openapiPlugin);
  await app.register(authPlugin);

  // One log line per request, in the same JSON format as the batch tasks.
  app.addHook('onResponse', async (req, reply) => {
    req.log.info({
      reqId: req.id,
      method: req.method,
      path: req.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });

  await app.register(healthRoutes);
  await app.register(townRoutes);
  await app.register(sourceRoutes);
  await app.register(timeRangeRoutes);
  await app.register(measurementRoutes);
  await app.register(comparisonRoutes);
  await app.register(reliabilityRoutes);
  await app.register(reportRoutes);
  if (env.API_ENABLE_ADMIN) {
    await app.register(adminRoutes, { prefix: '/admin' });
  }

  await app.ready();
  return app;
}

export type ApiServer = Awaited<ReturnType<typeof buildServer>>;
