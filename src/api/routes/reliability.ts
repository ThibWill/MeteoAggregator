import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { errorResponses } from '../schemas/common.js';
import { ReliabilityQuery, ReliabilitySchema } from '../schemas/reliability.js';
import { getReliability } from '../services/reliability.js';

export const reliabilityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/reliability',
    {
      schema: {
        tags: ['analysis'],
        summary: 'Rolling-window forecast reliability statistics',
        description:
          'Group stats and the category confusion matrix over the 7d/30d/365d ' +
          'windows, with town names and time-range codes resolved.',
        querystring: ReliabilityQuery,
        response: { 200: ReliabilitySchema, ...errorResponses },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'public, max-age=300');
      return { data: await getReliability(req.query) };
    },
  );
};
