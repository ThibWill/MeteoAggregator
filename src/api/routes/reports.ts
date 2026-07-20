import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { envelope, errorResponses } from '../schemas/common.js';
import {
  ReportDetailQuery,
  ReportDetailSchema,
  ReportIdParams,
  ReportListQuery,
  ReportSchema,
  ReportSummaryQuery,
  ReportSummaryRowSchema,
} from '../schemas/report.js';
import { getReport, listReports, reportSummary } from '../services/reports.js';

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/reports',
    {
      schema: {
        tags: ['reports'],
        summary: 'Batch run history',
        querystring: ReportListQuery,
        response: { 200: envelope(ReportSchema), ...errorResponses },
      },
    },
    async (req) => listReports(req.query),
  );

  // Declared before /reports/:id so the literal segment is unambiguous.
  app.get(
    '/reports/summary',
    {
      schema: {
        tags: ['reports'],
        summary: 'Per run_date status counts',
        querystring: ReportSummaryQuery,
        response: { 200: envelope(ReportSummaryRowSchema), ...errorResponses },
      },
    },
    async (req) => reportSummary(req.query),
  );

  app.get(
    '/reports/:id',
    {
      schema: {
        tags: ['reports'],
        summary: 'One report with its measurements',
        params: ReportIdParams,
        querystring: ReportDetailQuery,
        response: { 200: ReportDetailSchema, ...errorResponses },
      },
    },
    async (req) => getReport(req.params.id, req.query),
  );
};
