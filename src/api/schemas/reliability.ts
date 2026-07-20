import { z } from 'zod';
import { IntParam } from './common.js';

export const GroupStatSchema = z.object({
  sourceId: z.number().int(),
  sourceCode: z.string().nullable(),
  townId: z.number().int(),
  townName: z.string().nullable(),
  timeRangeId: z.number().int(),
  timeRangeCode: z.string().nullable(),
  leadDays: z.number().int().nullable(),
  n: z.number().int(),
  catAgreePct: z.number().nullable(),
  precipAgreePct: z.number().nullable(),
  tempMae: z.number().nullable(),
  tempBias: z.number().nullable(),
  precipMae: z.number().nullable(),
  precipBias: z.number().nullable(),
  windMae: z.number().nullable(),
  windBias: z.number().nullable(),
  gustMae: z.number().nullable(),
  cloudMae: z.number().nullable(),
});

export const ConfusionCellSchema = z.object({
  forecast: z.string(),
  observed: z.string(),
  count: z.number().int(),
});

export const WindowReportSchema = z.object({
  window: z.string(),
  days: z.number().int(),
  since: z.string(),
  groups: z.array(GroupStatSchema),
  confusion: z.array(ConfusionCellSchema),
});

export const ReliabilityQuery = z.object({
  townId: IntParam.optional(),
  town: z.string().optional(),
  sourceId: IntParam.optional(),
  source: z.string().optional(),
  observedSource: z.string().default('mf-climatologie'),
  window: z.enum(['7d', '30d', '365d']).optional(),
});

export const ReliabilitySchema = z.object({
  data: z.array(WindowReportSchema),
});
