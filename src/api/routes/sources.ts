import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { envelope, errorResponses } from '../schemas/common.js';
import { SourceListQuery, SourceSchema } from '../schemas/source.js';
import { listSources } from '../services/reference.js';

export const sourceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/sources',
    {
      schema: {
        tags: ['reference'],
        summary: 'List weather sources (connectors)',
        querystring: SourceListQuery,
        response: { 200: envelope(SourceSchema), ...errorResponses },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'public, max-age=60');
      return listSources(req.query);
    },
  );
};
