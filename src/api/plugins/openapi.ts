import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

export const openapiPlugin = fp(async (app) => {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'MeteoAggregator API',
        description:
          'Read API over the aggregated weather database: towns, sources, ' +
          'time ranges, measurements, forecast-vs-observed comparison, ' +
          'reliability and run reports. All times are UTC (ISO-8601).',
        version: '0.1.0',
      },
      tags: [
        { name: 'meta', description: 'Health and service metadata' },
        { name: 'reference', description: 'Towns, sources, time ranges' },
        { name: 'measurements', description: 'Forecast and observation data' },
        { name: 'analysis', description: 'Forecast-vs-observed and reliability' },
        { name: 'reports', description: 'Batch run history' },
        { name: 'admin', description: 'Job triggers (not part of the read contract)' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
});
