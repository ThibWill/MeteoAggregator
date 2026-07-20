import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { prisma } from '../../db/client.js';

const HealthSchema = z.object({
  status: z.literal('ok'),
  uptimeS: z.number(),
});

const DbHealthSchema = z.object({
  status: z.enum(['ok', 'error']),
  latencyMs: z.number().nullable(),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['meta'],
        summary: 'Liveness probe (no DB access)',
        response: { 200: HealthSchema },
      },
    },
    async () => ({ status: 'ok' as const, uptimeS: Math.round(process.uptime()) }),
  );

  app.get(
    '/health/db',
    {
      schema: {
        tags: ['meta'],
        summary: 'Readiness probe: SELECT 1 through Prisma',
        response: { 200: DbHealthSchema, 503: DbHealthSchema },
      },
    },
    async (req, reply) => {
      const started = Date.now();
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { status: 'ok' as const, latencyMs: Date.now() - started };
      } catch (err) {
        req.log.error({ err }, 'db health check failed');
        return reply.code(503).send({ status: 'error' as const, latencyMs: null });
      }
    },
  );
};
