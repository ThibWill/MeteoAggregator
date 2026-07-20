import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { envelope, errorResponses } from '../schemas/common.js';
import { ComparisonQuery, ComparisonRowSchema } from '../schemas/comparison.js';
import { listComparison } from '../services/comparison.js';

export const comparisonRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/comparison',
    {
      schema: {
        tags: ['analysis'],
        summary: 'Forecast rows paired with their observed counterpart',
        description:
          'Reads the forecast_vs_observed view. Per-row detail — see ' +
          '/reliability for the aggregate.',
        querystring: ComparisonQuery,
        response: { 200: envelope(ComparisonRowSchema), ...errorResponses },
      },
    },
    async (req) => listComparison(req.query),
  );
};
