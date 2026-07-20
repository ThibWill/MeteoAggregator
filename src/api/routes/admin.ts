import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { dailyRun } from '../../tasks/dailyRun.js';
import { backfillObservations } from '../../tasks/backfillObservations.js';
import { badRequest, notFound } from '../errors.js';
import { envelope, errorResponses } from '../schemas/common.js';
import { BackfillBody, DailyRunBody, JobIdParams, JobSchema } from '../schemas/job.js';
import { getJob, listJobs, startJob, type JobRecord } from '../services/jobs.js';

const toDto = (j: JobRecord) => ({
  jobId: j.id,
  type: j.type,
  status: j.status,
  startedAt: j.startedAt,
  finishedAt: j.finishedAt,
  params: j.params,
  result: j.result,
  error: j.error,
});

const conflictResponses = { ...errorResponses, 409: errorResponses[400] };

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/jobs/daily-run',
    {
      schema: {
        tags: ['admin'],
        summary: 'Start the daily forecast + observation run',
        body: DailyRunBody,
        response: { 202: JobSchema, ...conflictResponses },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const job = startJob('daily-run', { ...body }, () => dailyRun(body));
      return reply.code(202).send(toDto(job));
    },
  );

  app.post(
    '/jobs/backfill-observations',
    {
      schema: {
        tags: ['admin'],
        summary: 'Re-fetch the observation archive over a day range',
        body: BackfillBody,
        response: { 202: JobSchema, ...conflictResponses },
      },
    },
    async (req, reply) => {
      const body = req.body;
      if (body.to < body.from) {
        throw badRequest(`'to' (${body.to}) must be on or after 'from' (${body.from})`);
      }
      const job = startJob('backfill-observations', { ...body }, () =>
        backfillObservations(body),
      );
      return reply.code(202).send(toDto(job));
    },
  );

  app.get(
    '/jobs',
    {
      schema: {
        tags: ['admin'],
        summary: 'Recent jobs (in-memory; lost on restart)',
        querystring: z.object({
          limit: z.coerce.number().int().positive().max(200).default(50),
        }),
        response: { 200: envelope(JobSchema), ...errorResponses },
      },
    },
    async (req) => {
      const data = listJobs(req.query.limit).map(toDto);
      return { data, meta: { total: data.length, limit: req.query.limit, offset: 0 } };
    },
  );

  app.get(
    '/jobs/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'One job',
        params: JobIdParams,
        response: { 200: JobSchema, ...errorResponses },
      },
    },
    async (req) => {
      const job = getJob(req.params.id);
      if (!job) throw notFound(`job not found: ${req.params.id}`);
      return toDto(job);
    },
  );
};
