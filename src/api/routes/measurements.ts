import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { envelope, errorResponses } from '../schemas/common.js';
import {
  MeasurementListQuery,
  MeasurementSchema,
  TimeseriesQuery,
  TimeseriesSchema,
} from '../schemas/measurement.js';
import { getTimeseries, listMeasurements } from '../services/measurements.js';

export const measurementRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/measurements',
    {
      schema: {
        tags: ['measurements'],
        summary: 'Forecast and observation rows for one town over a period',
        description:
          'A town filter is required. `latestOnly=true` (the default) keeps only ' +
          'the most recent model run per (source, target date, time range). ' +
          '`raw` is excluded unless `include=raw`.',
        querystring: MeasurementListQuery,
        response: { 200: envelope(MeasurementSchema), ...errorResponses },
      },
    },
    async (req) => listMeasurements(req.query),
  );

  app.get(
    '/measurements/timeseries',
    {
      schema: {
        tags: ['measurements'],
        summary: 'The same rows pivoted into chart-ready series',
        description:
          'One series per (source, kind); `points` align positionally with ' +
          '`index`, with null for gaps.',
        querystring: TimeseriesQuery,
        response: { 200: TimeseriesSchema, ...errorResponses },
      },
    },
    async (req) => getTimeseries({ ...req.query, include: undefined }),
  );
};
