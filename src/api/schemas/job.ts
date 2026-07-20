import { z } from 'zod';
import { DateOnly } from './common.js';

export const JobSchema = z.object({
  jobId: z.string(),
  type: z.enum(['daily-run', 'backfill-observations']),
  status: z.enum(['RUNNING', 'SUCCESS', 'FAILED']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  params: z.record(z.unknown()),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
});

export const DailyRunBody = z
  .object({
    townName: z.string().optional(),
    observationSourceCode: z.string().optional(),
  })
  .default({});

export const BackfillBody = z.object({
  from: DateOnly,
  to: DateOnly,
  townName: z.string().optional(),
  observationSourceCode: z.string().optional(),
});

export const JobIdParams = z.object({ id: z.string() });
