import { z } from 'zod';
import {
  IntParam,
  PaginationQuery,
  PeriodQuery,
  PositiveIntParam,
  ReportStatusEnum,
} from './common.js';
import { MeasurementSchema } from './measurement.js';

export const ReportSchema = z.object({
  id: z.number().int(),
  runDate: z.string(),
  townId: z.number().int(),
  sourceId: z.number().int(),
  modelRunTime: z.string().nullable(),
  horizonDays: z.number().int(),
  status: ReportStatusEnum,
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  measurementCount: z.number().int(),
});

export const ReportDetailSchema = ReportSchema.extend({
  measurements: z.array(MeasurementSchema),
  measurementMeta: z.object({
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  }),
});

export const ReportListQuery = PaginationQuery.merge(PeriodQuery).extend({
  townId: IntParam.optional(),
  town: z.string().optional(),
  sourceId: IntParam.optional(),
  source: z.string().optional(),
  status: ReportStatusEnum.optional(),
});

export const ReportIdParams = z.object({ id: PositiveIntParam });

export const ReportDetailQuery = PaginationQuery;

export const ReportSummaryRowSchema = z.object({
  runDate: z.string(),
  total: z.number().int(),
  pending: z.number().int(),
  success: z.number().int(),
  partial: z.number().int(),
  failed: z.number().int(),
});

export const ReportSummaryQuery = PeriodQuery;
