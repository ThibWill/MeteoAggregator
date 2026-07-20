import { z } from 'zod';
import {
  BoolParam,
  IntParam,
  MeasurementKindEnum,
  PaginationQuery,
  PeriodQuery,
  PrecipLevelEnum,
  WeatherCategoryEnum,
  repeatable,
} from './common.js';

export const MeasurementValuesSchema = z.object({
  precipitationMm: z.number().nullable(),
  cloudCoverPct: z.number().nullable(),
  temperatureC: z.number().nullable(),
  windSpeedMs: z.number().nullable(),
  windGustMs: z.number().nullable(),
  capeJkg: z.number().nullable(),
});

export const MeasurementSchema = z.object({
  id: z.number().int(),
  kind: MeasurementKindEnum,
  townId: z.number().int(),
  sourceId: z.number().int(),
  sourceCode: z.string(),
  targetDate: z.string(),
  timeRangeId: z.number().int(),
  timeRangeCode: z.string().nullable(),
  referenceTime: z.string().nullable(),
  runDate: z.string().nullable(),
  leadDays: z.number().int().nullable(),
  values: MeasurementValuesSchema,
  category: WeatherCategoryEnum,
  precipLevel: PrecipLevelEnum,
  /** Source-specific payload; only present with `?include=raw`. */
  raw: z.unknown().optional(),
});

const townFilter = {
  townId: IntParam.optional(),
  town: z.string().optional(),
};

const sourceFilter = {
  sourceId: repeatable(IntParam),
  source: repeatable(z.string()),
};

export const MeasurementListQuery = PaginationQuery.merge(PeriodQuery).extend({
  ...townFilter,
  ...sourceFilter,
  kind: MeasurementKindEnum.optional(),
  timeRangeId: repeatable(IntParam),
  leadDays: repeatable(IntParam),
  latestOnly: BoolParam.default('true'),
  include: z.enum(['raw']).optional(),
});

export const TimeseriesQuery = MeasurementListQuery.omit({ include: true });

export const TimeseriesIndexEntry = z.object({
  targetDate: z.string(),
  timeRangeId: z.number().int(),
  timeRangeCode: z.string().nullable(),
});

export const TimeseriesPointSchema = MeasurementValuesSchema.extend({
  category: WeatherCategoryEnum,
  precipLevel: PrecipLevelEnum,
  referenceTime: z.string().nullable(),
  leadDays: z.number().int().nullable(),
});

export const TimeseriesSeriesSchema = z.object({
  sourceId: z.number().int(),
  sourceCode: z.string(),
  kind: MeasurementKindEnum,
  /** Aligned positionally with `index`; `null` where there is no measurement. */
  points: z.array(TimeseriesPointSchema.nullable()),
});

export const TimeseriesSchema = z.object({
  index: z.array(TimeseriesIndexEntry),
  series: z.array(TimeseriesSeriesSchema),
  meta: z.object({
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  }),
});
