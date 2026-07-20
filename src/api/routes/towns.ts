import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { envelope, errorResponses } from '../schemas/common.js';
import { TownDetailSchema, TownIdParams, TownListQuery, TownSchema } from '../schemas/town.js';
import { getTown, listTowns } from '../services/reference.js';

const REFERENCE_CACHE = 'public, max-age=60';

export const townRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/towns',
    {
      schema: {
        tags: ['reference'],
        summary: 'List tracked towns',
        querystring: TownListQuery,
        response: { 200: envelope(TownSchema), ...errorResponses },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', REFERENCE_CACHE);
      return listTowns(req.query);
    },
  );

  app.get(
    '/towns/:id',
    {
      schema: {
        tags: ['reference'],
        summary: 'One town, with its source links and measurement coverage',
        params: TownIdParams,
        response: { 200: TownDetailSchema, ...errorResponses },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', REFERENCE_CACHE);
      return getTown(req.params.id);
    },
  );
};
