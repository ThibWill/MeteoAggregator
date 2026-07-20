import { z } from 'zod';
import { BoolParam, PaginationQuery, PositiveIntParam } from './common.js';

export const TownSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  country: z.string(),
  adminArea: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  timezone: z.string(),
  active: z.boolean(),
  geocodedAt: z.string().nullable(),
});

export const TownSourceLinkSchema = z.object({
  sourceId: z.number().int(),
  sourceCode: z.string(),
  active: z.boolean(),
  stationId: z.string().nullable(),
  stationMeta: z.unknown().nullable(),
});

export const TownCoverageSchema = z.object({
  firstTargetDate: z.string().nullable(),
  lastTargetDate: z.string().nullable(),
  measurementCount: z.number().int(),
});

export const TownDetailSchema = TownSchema.extend({
  sources: z.array(TownSourceLinkSchema),
  coverage: TownCoverageSchema,
});

export const TownListQuery = PaginationQuery.extend({
  q: z.string().min(1).optional(),
  active: BoolParam.default('true'),
  country: z.string().optional(),
});

export const TownIdParams = z.object({ id: PositiveIntParam });
