import { z } from 'zod';
import {
  BoolParam,
  IntParam,
  PaginationQuery,
  PeriodQuery,
  PrecipLevelEnum,
  WeatherCategoryEnum,
  repeatable,
} from './common.js';

const NumericPair = z.object({
  forecast: z.number().nullable(),
  observed: z.number().nullable(),
});

export const ComparisonRowSchema = z.object({
  townId: z.number().int(),
  sourceId: z.number().int(),
  sourceCode: z.string(),
  targetDate: z.string(),
  timeRangeId: z.number().int(),
  timeRangeCode: z.string().nullable(),
  referenceTime: z.string().nullable(),
  runDate: z.string().nullable(),
  leadDays: z.number().int().nullable(),
  observedSourceId: z.number().int().nullable(),
  precipitationMm: NumericPair,
  cloudCoverPct: NumericPair,
  temperatureC: NumericPair,
  windSpeedMs: NumericPair,
  windGustMs: NumericPair,
  capeJkg: NumericPair,
  category: z.object({
    forecast: WeatherCategoryEnum,
    observed: WeatherCategoryEnum.nullable(),
  }),
  precipLevel: z.object({
    forecast: PrecipLevelEnum,
    observed: PrecipLevelEnum.nullable(),
  }),
  /** forecast − observed, null where either side is missing. */
  delta: z.object({
    precipitationMm: z.number().nullable(),
    cloudCoverPct: z.number().nullable(),
    temperatureC: z.number().nullable(),
    windSpeedMs: z.number().nullable(),
    windGustMs: z.number().nullable(),
    capeJkg: z.number().nullable(),
  }),
  categoryMatch: z.boolean().nullable(),
  precipLevelMatch: z.boolean().nullable(),
});

export const ComparisonQuery = PaginationQuery.merge(PeriodQuery).extend({
  townId: IntParam.optional(),
  town: z.string().optional(),
  sourceId: repeatable(IntParam),
  source: repeatable(z.string()),
  timeRangeId: repeatable(IntParam),
  leadDays: repeatable(IntParam),
  onlyMatched: BoolParam.default('true'),
});
