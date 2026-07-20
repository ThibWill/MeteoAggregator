import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { envelope, errorResponses } from '../schemas/common.js';
import { TimeRangeSchema } from '../schemas/timeRange.js';
import { listTimeRanges } from '../services/reference.js';

export const timeRangeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/time-ranges',
    {
      schema: {
        tags: ['reference'],
        summary: 'Active intra-day windows, ordered by sortOrder',
        response: { 200: envelope(TimeRangeSchema), ...errorResponses },
      },
    },
    async (_req, reply) => {
      reply.header('cache-control', 'public, max-age=60');
      return listTimeRanges();
    },
  );
};
